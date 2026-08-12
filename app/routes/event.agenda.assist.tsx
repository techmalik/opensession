// AI assist: propose slots for everything still unscheduled, show the proposal as a
// diff with a one-line reason per row, and let the organizer apply all of it or just
// the rows they like. Nothing is written until Apply.

import { Form, Link } from "react-router";
import type { Route } from "./+types/event.agenda.assist";
import { requireOrganizer } from "../lib/session.server";
import { loadAgenda, notifySchedule, placeSession } from "../lib/agenda.server";
import { offsetForTimeValue, slotLabel } from "../lib/agenda-grid";
import { proposeSchedule } from "../lib/ai.server";
import { ASSIST_SOURCE_LABEL } from "../lib/labels";
import { formatDayLabel } from "../lib/format";
import { Breadcrumbs, Card, EmptyState, ErrorNotice, Notice, PageHeader, buttonPrimary, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "AI agenda assist" }];
}

function labelForTime(time: string): string {
  return slotLabel(offsetForTimeValue(time));
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const data = await loadAgenda(eventId);

  const url = new URL(request.url);
  const run = url.searchParams.get("run") === "1";
  if (!run) {
    return {
      event: data.event,
      unscheduledCount: data.unscheduled.length,
      proposal: null,
      source: null,
      note: null,
    };
  }

  const result = await proposeSchedule(data);
  const roomById = new Map(data.rooms.map((room) => [room.id, room.name]));
  const sessionById = new Map(data.unscheduled.map((session) => [session.id, session]));

  return {
    event: data.event,
    unscheduledCount: data.unscheduled.length,
    source: result.source,
    note: result.note,
    proposal: result.placements.map((placement) => ({
      ...placement,
      title: sessionById.get(placement.sessionId)?.title ?? `Session ${placement.sessionId}`,
      durationMin: sessionById.get(placement.sessionId)?.durationMin ?? 30,
      roomName: roomById.get(placement.roomId) ?? "Room",
      dayLabel: formatDayLabel(placement.day, data.event.timezone),
      timeLabel: labelForTime(placement.time),
    })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const data = await loadAgenda(eventId);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "apply") return { error: null, notice: null };

  const notify = String(form.get("notify") ?? "") === "1";
  // "Apply this row" posts a single `only` value; the footer button posts every
  // checked `placement`. The single row wins when both are present.
  const only = form.get("only");
  const raws = only != null ? [only] : form.getAll("placement");
  const rows = raws
    .map((raw) => {
      try {
        const parsed = JSON.parse(String(raw)) as { sessionId: number; roomId: number; day: string; time: string };
        return parsed;
      } catch {
        return null;
      }
    })
    .filter((row): row is { sessionId: number; roomId: number; day: string; time: string } => row != null);

  if (rows.length === 0) return { error: "Nothing selected to apply.", notice: null };

  let applied = 0;
  let queued = 0;
  for (const row of rows) {
    const session = data.unscheduled.find((item) => item.id === row.sessionId);
    if (!session) continue;
    const placed = await placeSession(
      eventId,
      row.sessionId,
      { roomId: row.roomId, day: row.day, time: row.time, durationMin: session.durationMin },
      data.event.timezone
    );
    if (!placed) continue;
    applied += 1;
    if (notify) queued += await notifySchedule(eventId, row.sessionId);
  }

  return {
    error: null,
    notice: `Applied ${applied} ${applied === 1 ? "placement" : "placements"}${
      queued > 0 ? `, queued ${queued} schedule ${queued === 1 ? "email" : "emails"}` : ""
    }.`,
  };
}

export default function AgendaAssist({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, unscheduledCount, proposal, source, note } = loaderData;
  const base = `/admin/${params.eventId}`;

  return (
    <>
      <Breadcrumbs items={[{ to: `${base}/agenda`, label: "Agenda" }, { label: "AI assist" }]} />

      <PageHeader
        title="AI agenda assist"
        description={`Propose slots for the ${unscheduledCount} unscheduled ${unscheduledCount === 1 ? "session" : "sessions"} at ${event.name}. Review before anything moves.`}
        actions={
          <Link to="?run=1" className={buttonPrimary}>
            {proposal ? "Propose again" : "Propose a schedule"}
          </Link>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? (
        <>
          <Notice>{actionData.notice}</Notice>
          <Link to={`${base}/agenda`} className={`${buttonPrimary} mb-4`}>
            Back to the agenda
          </Link>
        </>
      ) : null}

      {source ? (
        <Notice>
          Proposed by {ASSIST_SOURCE_LABEL[source]}
          {note ? `. ${note}` : "."}
        </Notice>
      ) : null}

      {!proposal ? (
        <Card>
          <EmptyState
            message="Nothing proposed yet. The assistant places longer sessions first, keeps every speaker in one place at a time, and spreads tracks across rooms."
            action={
              <Link to="?run=1" className={buttonPrimary}>
                Propose a schedule
              </Link>
            }
          />
        </Card>
      ) : proposal.length === 0 ? (
        <Card>
          <EmptyState
            message="No placements to propose. Either everything is scheduled, or there is no free slot left."
            action={
              <Link to={`${base}/agenda`} className={buttonSecondary}>
                Back to the agenda
              </Link>
            }
          />
        </Card>
      ) : (
        <Form method="post">
          <input type="hidden" name="intent" value="apply" />
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Proposal ({proposal.length} {proposal.length === 1 ? "placement" : "placements"})
              </h2>
              <label className="flex items-center gap-2 text-[13px] text-slate-900">
                <input type="checkbox" name="notify" value="1" defaultChecked className="accent-accent" />
                Email the speakers
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="w-8 px-3 py-2">
                      <span className="sr-only">Apply</span>
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">Session</th>
                    <th scope="col" className="px-3 py-2 font-medium">Proposed slot</th>
                    <th scope="col" className="px-3 py-2 font-medium">Why</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Apply row</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.map((row) => {
                    const payload = JSON.stringify({
                      sessionId: row.sessionId,
                      roomId: row.roomId,
                      day: row.day,
                      time: row.time,
                    });
                    return (
                      <tr key={row.sessionId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-3">
                          <input
                            type="checkbox"
                            name="placement"
                            value={payload}
                            defaultChecked
                            aria-label={`Apply the proposed slot for ${row.title}`}
                            className="accent-accent"
                          />
                        </td>
                        <td className="h-10 max-w-[260px] px-3">
                          <span className="block truncate font-medium text-slate-900">{row.title}</span>
                          <span className="text-slate-500">{row.durationMin} min</span>
                        </td>
                        <td className="px-3 text-slate-900">
                          <span className="text-slate-400">unscheduled to </span>
                          {row.dayLabel}, {row.timeLabel}, {row.roomName}
                        </td>
                        <td className="max-w-[280px] px-3 text-slate-500">{row.reason}</td>
                        <td className="px-3 text-right">
                          <button type="submit" name="only" value={payload} className="font-medium text-accent hover:underline">
                            Apply this row
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
              <button type="submit" className={buttonPrimary}>
                Apply all checked
              </button>
              <Link to={`${base}/agenda`} className={buttonSecondary}>
                Cancel
              </Link>
            </div>
          </Card>
        </Form>
      )}
    </>
  );
}
