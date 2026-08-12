// The sourcing pipeline: a kanban board from research to confirmed or declined.
// Cards move with a Move-to control on the card, not only by dragging, because the
// board has to work for a keyboard and for an agent that cannot drag.

import { Form, Link } from "react-router";
import type { Route } from "./+types/crm.pipeline";
import { requireOrganizer } from "../lib/session.server";
import { enrollProspect, listContacts, listEventsForPicker, listProspects, moveProspect, removeProspect } from "../lib/crm.server";
import { CRM_STAGES, isCrmStage, STAGE_LABEL } from "../lib/crm-view";
import { formatDateTime } from "../lib/format";
import { Card, ErrorNotice, Field, Notice, PageHeader, buttonPrimary, buttonSecondary, inputClass, selectClass, textareaClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Pipeline" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const url = new URL(request.url);
  const cards = await listProspects();
  const enrolled = new Set(cards.map((card) => card.contactId));

  return {
    stages: CRM_STAGES,
    columns: CRM_STAGES.map((stage) => ({
      ...stage,
      cards: cards.filter((card) => card.stage === stage.key),
    })),
    total: cards.length,
    candidates: (await listContacts()).filter((row) => !enrolled.has(row.id)),
    events: await listEventsForPicker(),
    enrollOpen: url.searchParams.get("enroll") === "1",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const author = { id: user.id, name: user.name };

  if (intent === "enroll") {
    const contactId = Number(form.get("contactId") ?? 0);
    const stage = String(form.get("stage") ?? "identified");
    if (!contactId) return { error: "Choose a contact to enroll.", notice: null };
    if (!isCrmStage(stage)) return { error: "That stage does not exist.", notice: null };
    const scoreRaw = String(form.get("score") ?? "").trim();
    const score = scoreRaw ? Number(scoreRaw) : null;
    if (score != null && (Number.isNaN(score) || score < 0 || score > 100)) {
      return { error: "Score must be a number from 0 to 100.", notice: null };
    }
    await enrollProspect({
      contactId,
      stage,
      score,
      rationale: String(form.get("rationale") ?? "").trim(),
      eventId: Number(form.get("eventId") ?? 0) || null,
      author,
    });
    return { error: null, notice: `Enrolled at ${STAGE_LABEL[stage]}.` };
  }

  if (intent === "move") {
    const prospectId = Number(form.get("prospectId") ?? 0);
    const stage = String(form.get("stage") ?? "");
    if (!isCrmStage(stage)) return { error: "That stage does not exist.", notice: null };
    const moved = await moveProspect(prospectId, stage, author);
    return { error: null, notice: moved ? `Moved to ${STAGE_LABEL[stage]}.` : "That card is already in that stage." };
  }

  if (intent === "remove") {
    await removeProspect(Number(form.get("prospectId") ?? 0));
    return { error: null, notice: "Removed from the pipeline." };
  }

  return { error: null, notice: null };
}

export default function CrmPipeline({ loaderData, actionData }: Route.ComponentProps) {
  const { columns, stages, total, candidates, events, enrollOpen } = loaderData;

  return (
    <>
      <PageHeader
        title="Sourcing pipeline"
        description={`${total} ${total === 1 ? "prospect" : "prospects"} from research through confirmed.`}
        actions={
          <Link to={enrollOpen ? "/crm/pipeline" : "/crm/pipeline?enroll=1"} className={buttonPrimary}>
            {enrollOpen ? "Close" : "Enroll a contact"}
          </Link>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      {enrollOpen ? (
        <Card className="mb-4 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Enroll a contact</h2>
          {candidates.length === 0 ? (
            <p className="mt-2 text-[13px] text-slate-500">
              Every contact is already on the board.{" "}
              <Link to="/crm/contacts/new" className="font-medium text-accent hover:underline">
                Add a contact
              </Link>
            </p>
          ) : (
            <Form method="post" className="mt-3 grid max-w-[640px] gap-3">
              <input type="hidden" name="intent" value="enroll" />
              <Field label="Contact" name="contactId" required>
                <select id="contactId" name="contactId" className={selectClass} required>
                  {candidates.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.company ? `, ${row.company}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Field label="Starting stage" name="stage">
                  <select id="stage" name="stage" defaultValue="identified" className={selectClass}>
                    {stages.map((stage) => (
                      <option key={stage.key} value={stage.key}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Score" name="score" help="0 to 100, optional.">
                  <input id="score" name="score" type="number" min={0} max={100} className={inputClass} />
                </Field>
              </div>
              <Field label="Target event" name="eventId" help="Optional. A prospect can be sourced before an event exists.">
                <select id="eventId" name="eventId" defaultValue="" className={selectClass}>
                  <option value="">No specific event</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rationale" name="rationale">
                <textarea id="rationale" name="rationale" rows={3} className={textareaClass} />
              </Field>
              <div>
                <button type="submit" className={buttonPrimary}>
                  Enroll
                </button>
              </div>
            </Form>
          )}
        </Card>
      ) : null}

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {columns.map((column) => (
            <section key={column.key} id={column.key} className="w-[260px] shrink-0">
              <div className="flex items-baseline justify-between gap-2 rounded-t-lg border border-slate-200 bg-white px-3 py-2">
                <h2 className="text-[13px] font-semibold text-slate-900">
                  {column.label}
                  {column.terminal ? <span className="ml-1.5 font-normal text-slate-400">terminal</span> : null}
                </h2>
                <span className="text-[13px] tabular-nums text-slate-500">{column.cards.length}</span>
              </div>

              <div className="min-h-[160px] space-y-2 rounded-b-lg border border-t-0 border-slate-200 bg-slate-50 p-2">
                {column.cards.length === 0 ? (
                  <p className="px-1 py-4 text-[13px] text-slate-400">Nothing here.</p>
                ) : (
                  column.cards.map((card) => (
                    <article key={card.id} className="rounded-md border border-slate-200 bg-white p-2.5 shadow-sm">
                      <Link to={`/crm/pipeline/${card.id}`} className="text-[13px] font-medium text-slate-900 hover:text-accent">
                        {card.name}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-slate-500">{[card.title, card.company].filter(Boolean).join(", ")}</p>
                      {card.score != null ? (
                        <p className="mt-0.5 text-[13px] text-slate-500">Score {card.score}</p>
                      ) : null}
                      {card.eventName ? <p className="text-[13px] text-slate-500">{card.eventName}</p> : null}
                      <p className="mt-0.5 text-xs text-slate-400">
                        {card.noteCount} {card.noteCount === 1 ? "note" : "notes"}, moved {formatDateTime(card.updatedAt)}
                      </p>

                      <Form method="post" className="mt-2 flex items-center gap-1.5">
                        <input type="hidden" name="prospectId" value={card.id} />
                        <label htmlFor={`stage-${card.id}`} className="sr-only">
                          Move {card.name} to
                        </label>
                        <select
                          id={`stage-${card.id}`}
                          name="stage"
                          defaultValue={card.stage}
                          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900"
                        >
                          {stages.map((stage) => (
                            <option key={stage.key} value={stage.key}>
                              {stage.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          name="intent"
                          value="move"
                          className="inline-flex h-8 shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 hover:bg-slate-50"
                        >
                          Move
                        </button>
                      </Form>
                    </article>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
