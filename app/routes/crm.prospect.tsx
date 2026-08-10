// One pipeline card: notes and the stage history behind it. Every move and every
// note is a timestamped row, so the card explains how it got where it is.

import { Form, Link } from "react-router";
import type { Route } from "./+types/crm.prospect";
import { requireOrganizer } from "../lib/session.server";
import { addProspectNote, moveProspect, prospectDetail } from "../lib/crm.server";
import { CRM_STAGES, isCrmStage, STAGE_LABEL } from "../lib/crm-view";
import { formatDateTime } from "../lib/format";
import { Card, ErrorNotice, Notice, PageHeader, buttonPrimary, buttonSecondary, selectClass, textareaClass } from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.card ? `${loaderData.card.name} | Pipeline` : "Prospect" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const detail = await prospectDetail(Number(params.prospectId));
  if (!detail) throw new Response("Prospect not found", { status: 404 });
  return { card: detail.card, history: detail.history, stages: CRM_STAGES };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const prospectId = Number(params.prospectId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const author = { id: user.id, name: user.name };

  if (intent === "add-note") {
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { error: "Write the note first.", notice: null };
    await addProspectNote(prospectId, body, author);
    return { error: null, notice: "Note added." };
  }

  if (intent === "move") {
    const stage = String(form.get("stage") ?? "");
    if (!isCrmStage(stage)) return { error: "That stage does not exist.", notice: null };
    const moved = await moveProspect(prospectId, stage, author);
    return { error: null, notice: moved ? `Moved to ${STAGE_LABEL[stage]}.` : "Already in that stage." };
  }

  return { error: null, notice: null };
}

export default function CrmProspect({ loaderData, actionData }: Route.ComponentProps) {
  const { card, history, stages } = loaderData;

  return (
    <>
      <div className="mb-2 text-[13px]">
        <Link to="/crm/pipeline" className="text-slate-500 hover:text-slate-900">
          Pipeline
        </Link>
        <span className="mx-1 text-slate-400">/</span>
        <span className="text-slate-900">{card.name}</span>
      </div>

      <PageHeader
        title={card.name}
        description={[card.title, card.company].filter(Boolean).join(", ") || card.email}
        actions={
          <Link to={`/crm/contacts/${card.contactId}`} className={buttonSecondary}>
            Open contact record
          </Link>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Notes</h2>
            <Form method="post" className="mt-3 space-y-2">
              <input type="hidden" name="intent" value="add-note" />
              <label htmlFor="body" className="sr-only">
                Note
              </label>
              <textarea id="body" name="body" rows={3} placeholder="Call outcomes, next steps, who is chasing this" className={textareaClass} />
              <button type="submit" className={buttonPrimary}>
                Add note
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Stage history and notes</h2>
            <ol className="mt-3 divide-y divide-slate-100">
              {history.map((entry) => (
                <li key={entry.id} className="py-2.5">
                  <p className="text-[13px] font-medium text-slate-900">
                    {entry.kind === "stage"
                      ? `${STAGE_LABEL[(entry.fromStage ?? "identified") as keyof typeof STAGE_LABEL] ?? entry.fromStage} to ${
                          STAGE_LABEL[(entry.toStage ?? "identified") as keyof typeof STAGE_LABEL] ?? entry.toStage
                        }`
                      : entry.kind === "enrolled"
                        ? `Enrolled at ${STAGE_LABEL[(entry.toStage ?? "identified") as keyof typeof STAGE_LABEL] ?? entry.toStage}`
                        : "Note"}
                  </p>
                  {entry.body ? <p className="mt-0.5 text-sm text-slate-900">{entry.body}</p> : null}
                  <p className="mt-0.5 text-[13px] text-slate-500">
                    {entry.authorName}, {formatDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Stage</h2>
            <p className="mt-1 text-sm text-slate-900">{STAGE_LABEL[card.stage]}</p>
            <Form method="post" className="mt-3 flex items-center gap-2">
              <input type="hidden" name="intent" value="move" />
              <label htmlFor="stage" className="sr-only">
                Move to stage
              </label>
              <select id="stage" name="stage" defaultValue={card.stage} className={selectClass}>
                {stages.map((stage) => (
                  <option key={stage.key} value={stage.key}>
                    {stage.label}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonSecondary}>
                Move
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Sourcing detail</h2>
            <dl className="mt-2 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Score</dt>
                <dd className="tabular-nums text-slate-900">{card.score ?? "Not scored"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Target event</dt>
                <dd className="text-slate-900">{card.eventName ?? "None"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Email</dt>
                <dd className="truncate text-slate-900">{card.email}</dd>
              </div>
            </dl>
            {card.rationale ? <p className="mt-3 text-sm text-slate-900">{card.rationale}</p> : null}
          </Card>
        </div>
      </div>
    </>
  );
}
