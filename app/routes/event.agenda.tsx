// The agenda builder. Rooms are columns, 15-minute rows are the time axis, day tabs
// switch between event days. Sessions can be dragged onto a slot, but every drag has
// a plain form equivalent: the grid must work without a pointer.

import { useRef, useState } from "react";
import { Form, Link, useSearchParams, useSubmit } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/event.agenda";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { loadAgenda, notifySchedule, placeSession, placementDefaults, unplaceSession } from "../lib/agenda.server";
import { slotLabel, slotOffsets, slotTimeValue, AGENDA_START_HOUR, SLOT_MINUTES } from "../lib/agenda-grid";
import { formatDayLabel, formatTimeOfDay, toZonedDateValue, zonedParts } from "../lib/format";
import { events, sessions } from "../../database/schema";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Notice,
  PageHeader,
  PublicStateBadge,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  selectClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Agenda" }];
}

/** Pixels per 15-minute row. Dense enough that a full day fits one screen. */
const ROW_PX = 22;

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const data = await loadAgenda(eventId);

  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? data.days[0] ?? "";
  const view = url.searchParams.get("view") === "list" ? "list" : "grid";
  const placeId = Number(url.searchParams.get("place") ?? 0) || null;

  const placing = placeId
    ? ([...data.unscheduled, ...data.scheduled].find((session) => session.id === placeId) ?? null)
    : null;

  return {
    ...data,
    day,
    view,
    placing: placing
      ? {
          id: placing.id,
          title: placing.title,
          durationMin: placing.durationMin,
          roomId: placing.roomId,
          ...placementDefaults(placing, data.days, data.event.timezone),
        }
      : null,
    slots: slotOffsets().map((offset) => ({ offset, label: slotLabel(offset), time: slotTimeValue(offset) })),
    scheduled: data.scheduled.map((session) => ({
      ...session,
      day: session.startsAt ? toZonedDateValue(session.startsAt, data.event.timezone) : "",
      offsetMinutes: session.startsAt
        ? (() => {
            const parts = zonedParts(session.startsAt, data.event.timezone);
            return parts.hour * 60 + parts.minute - AGENDA_START_HOUR * 60;
          })()
        : 0,
    })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const event = await db
    .select({ id: events.id, timezone: events.timezone, slug: events.slug })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  if (intent === "place") {
    const sessionId = Number(form.get("sessionId") ?? 0);
    const roomId = Number(form.get("roomId") ?? 0) || null;
    const day = String(form.get("day") ?? "");
    const time = String(form.get("time") ?? "");
    const durationMin = Number(form.get("durationMin") ?? 30) || 30;
    if (!sessionId || !roomId || !day || !time) return { error: "Pick a session, a room, a day, and a time.", notice: null };

    const placed = await placeSession(eventId, sessionId, { roomId, day, time, durationMin }, event.timezone);
    if (!placed) return { error: "That day or time could not be read.", notice: null };

    const notify = String(form.get("notify") ?? "") === "1";
    const queued = notify ? await notifySchedule(eventId, sessionId) : 0;
    return {
      error: null,
      notice: queued > 0 ? `Session placed. Queued ${queued} schedule ${queued === 1 ? "email" : "emails"} with an updated calendar file.` : "Session placed.",
    };
  }

  if (intent === "unplace") {
    const sessionId = Number(form.get("sessionId") ?? 0);
    await unplaceSession(eventId, sessionId);
    return { error: null, notice: "Session moved back to the unscheduled list." };
  }

  // CNT-12: hold a placed session back from every public surface, or let it out
  // again, without unscheduling it.
  if (intent === "hold-public" || intent === "publish-public") {
    const sessionId = Number(form.get("sessionId") ?? 0);
    await db
      .update(sessions)
      .set({ publicState: intent === "hold-public" ? "held" : "published", updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));
    return {
      error: null,
      notice: intent === "hold-public" ? "Held from public." : "Published to public.",
    };
  }

  if (intent === "publish" || intent === "unpublish") {
    await db
      .update(events)
      .set({ agendaPublishedAt: intent === "publish" ? new Date() : null })
      .where(eq(events.id, eventId));
    return {
      error: null,
      notice:
        intent === "publish"
          ? `Agenda published. The public schedule is at /agenda/${event.slug}.`
          : "Agenda unpublished. The public schedule is hidden again.",
    };
  }

  return { error: null, notice: null };
}

export default function Agenda({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, rooms, days, scheduled, unscheduled, conflicts, day, view, placing, slots } = loaderData;
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const base = `/admin/${params.eventId}`;
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; title: string; x: number; y: number } | null>(null);

  const conflictIds = new Set(conflicts.flatMap((conflict) => conflict.sessionIds));
  const dayScheduled = scheduled.filter((session) => session.day === day);

  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    return `?${next.toString()}`;
  };

  /** Pointer drag: on release, whatever slot is under the cursor becomes the target.
   *  Falls through to the placement form when the release lands outside the grid. */
  const startDrag = (sessionId: number, title: string, event0: React.PointerEvent) => {
    if (event0.button !== 0) return;
    setDrag({ id: sessionId, title, x: event0.clientX, y: event0.clientY });

    const move = (e: PointerEvent) => setDrag((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-slot]") as HTMLElement | null;
      if (!target) return;
      const body = new FormData();
      body.set("intent", "place");
      body.set("sessionId", String(sessionId));
      body.set("roomId", target.dataset.room ?? "");
      body.set("day", target.dataset.day ?? "");
      body.set("time", target.dataset.time ?? "");
      body.set("durationMin", String(durationOf(sessionId)));
      body.set("notify", "1");
      submit(body, { method: "post" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const durationOf = (id: number) =>
    [...unscheduled, ...scheduled].find((session) => session.id === id)?.durationMin ?? 30;

  return (
    <>
      <PageHeader
        title="Agenda"
        description={
          days.length === 0
            ? "Set the event dates under Settings to lay out the agenda."
            : `${scheduled.length} scheduled, ${unscheduled.length} to place, ${conflicts.length} ${conflicts.length === 1 ? "conflict" : "conflicts"}.`
        }
        actions={
          <>
            <Link to={`${base}/agenda/assist`} className={buttonSecondary}>
              AI assist
            </Link>
            <Form method="post">
              <button
                type="submit"
                name="intent"
                value={event.agendaPublishedAt ? "unpublish" : "publish"}
                className={event.agendaPublishedAt ? buttonSecondary : buttonPrimary}
              >
                {event.agendaPublishedAt ? "Unpublish agenda" : "Publish agenda"}
              </button>
            </Form>
          </>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}
      {event.agendaPublishedAt ? (
        <Notice>
          Published. The public schedule is at{" "}
          <a href={`/agenda/${event.slug}`} className="font-medium text-accent hover:underline">
            /agenda/{event.slug}
          </a>
          .
        </Notice>
      ) : null}

      {rooms.length === 0 ? (
        <Card>
          <EmptyState
            message="No rooms yet. The agenda needs at least one room to schedule into."
            action={
              <Link to={`${base}/settings/taxonomy`} className={buttonPrimary}>
                Add rooms
              </Link>
            }
          />
        </Card>
      ) : null}

      {conflicts.length > 0 ? (
        <Card className="mb-4">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">
              Conflicts ({conflicts.length})
            </h2>
            <p className="mt-0.5 text-[13px] text-slate-500">
              Conflicting placements are allowed and flagged, not blocked. Move one of the pair to clear each row.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {conflicts.map((conflict, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <p className="text-[13px] text-slate-900">
                  <span className="mr-2 inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-rose-600" aria-hidden="true" />
                    {conflict.kind === "room" ? "Room" : conflict.kind === "speaker" ? "Speaker" : "Hours"}
                  </span>
                  {conflict.message}
                </p>
                <Link to={hrefWith("place", String(conflict.sessionIds[0]))} className={buttonSecondary}>
                  Fix
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {placing ? (
        <Card className="mb-4 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Place "{placing.title}"</h2>
          <Form method="post" className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="place" />
            <input type="hidden" name="sessionId" value={placing.id} />
            <input type="hidden" name="durationMin" value={placing.durationMin} />
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-slate-900">Day</span>
              <select name="day" defaultValue={placing.day} className={`${selectClass} w-44`}>
                {days.map((value) => (
                  <option key={value} value={value}>
                    {formatDayLabel(value, event.timezone)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-slate-900">Start time</span>
              <select name="time" defaultValue={placing.time} className={`${selectClass} w-36`}>
                {slots.map((slot) => (
                  <option key={slot.time} value={slot.time}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-slate-900">Room</span>
              <select name="roomId" defaultValue={placing.roomId ?? rooms[0]?.id ?? ""} className={`${selectClass} w-44`}>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-9 items-center gap-2 text-[13px] text-slate-900">
              <input type="checkbox" name="notify" value="1" defaultChecked className="accent-accent" />
              Email the speakers
            </label>
            <button type="submit" className={buttonPrimary}>
              Place session
            </button>
            <Link to={hrefWith("place", "")} className={buttonSecondary}>
              Cancel
            </Link>
          </Form>
          <p className="mt-2 text-[13px] text-slate-500">
            {placing.durationMin} minutes long. You can also drag the card straight onto a slot.
          </p>
        </Card>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {days.map((value) => (
            <Link
              key={value}
              to={hrefWith("day", value)}
              className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
                value === day ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
              }`}
            >
              {formatDayLabel(value, event.timezone)}
            </Link>
          ))}
        </div>
        <span className="mx-1 text-slate-300">|</span>
        <Link to={hrefWith("view", "grid")} className={view === "grid" ? buttonSecondary : buttonGhost}>
          Grid
        </Link>
        <Link to={hrefWith("view", "list")} className={view === "list" ? buttonSecondary : buttonGhost}>
          List
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <Card className="overflow-hidden">
          {view === "list" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-3 py-2 font-medium">Time</th>
                    <th scope="col" className="px-3 py-2 font-medium">Room</th>
                    <th scope="col" className="px-3 py-2 font-medium">Session</th>
                    <th scope="col" className="px-3 py-2 font-medium">Track</th>
                    <th scope="col" className="px-3 py-2 font-medium">Speakers</th>
                    <th scope="col" className="px-3 py-2 font-medium">Public</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dayScheduled.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-slate-500">
                        Nothing scheduled on this day yet.
                      </td>
                    </tr>
                  ) : (
                    [...dayScheduled]
                      .sort((a, b) => a.offsetMinutes - b.offsetMinutes)
                      .map((session) => (
                        <tr
                          key={session.id}
                          className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                            conflictIds.has(session.id) ? "bg-rose-50" : ""
                          }`}
                        >
                          <td className="h-10 whitespace-nowrap px-3 text-slate-900">
                            {formatTimeOfDay(session.startsAt, event.timezone)}
                          </td>
                          <td className="px-3 text-slate-500">{session.roomName}</td>
                          <td className="max-w-[280px] truncate px-3 font-medium text-slate-900">{session.title}</td>
                          <td className="px-3 text-slate-500">{session.trackName ?? ""}</td>
                          <td className="max-w-[180px] truncate px-3 text-slate-500">
                            {session.speakers.map((speaker) => speaker.name).join(", ")}
                          </td>
                          <td className="px-3">
                            <PublicStateBadge state={session.publicState} />
                          </td>
                          <td className="whitespace-nowrap px-3 text-right">
                            <Form method="post" className="inline">
                              <input type="hidden" name="sessionId" value={session.id} />
                              <button
                                type="submit"
                                name="intent"
                                value={session.publicState === "held" ? "publish-public" : "hold-public"}
                                className="mr-3 font-medium text-slate-500 hover:text-slate-900"
                              >
                                {session.publicState === "held" ? "Publish" : "Hold"}
                              </button>
                            </Form>
                            <Link to={hrefWith("place", String(session.id))} className="font-medium text-accent hover:underline">
                              Move
                            </Link>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div ref={gridRef} className="overflow-x-auto">
              <div className="flex min-w-max">
                <div className="w-16 shrink-0 border-r border-slate-200">
                  <div className="h-8 border-b border-slate-200" />
                  {slots.map((slot) => (
                    <div key={slot.offset} className="border-b border-slate-100 pr-2 text-right" style={{ height: ROW_PX }}>
                      {slot.offset % 60 === 0 ? (
                        <span className="text-xs leading-[22px] text-slate-500">{slot.label}</span>
                      ) : null}
                    </div>
                  ))}
                </div>

                {rooms.map((room) => (
                  <div key={room.id} className="w-[200px] shrink-0 border-r border-slate-200 last:border-r-0">
                    <div className="flex h-8 items-center border-b border-slate-200 px-2">
                      <span className="truncate text-[13px] font-medium text-slate-900">{room.name}</span>
                    </div>
                    <div className="relative">
                      {slots.map((slot) => (
                        <div
                          key={slot.offset}
                          data-slot="1"
                          data-room={room.id}
                          data-day={day}
                          data-time={slot.time}
                          className="border-b border-slate-100 hover:bg-slate-50"
                          style={{ height: ROW_PX }}
                        />
                      ))}

                      {dayScheduled
                        .filter((session) => session.roomId === room.id)
                        .map((session) => (
                          <div
                            key={session.id}
                            onPointerDown={(e) => startDrag(session.id, session.title, e)}
                            className={`absolute left-0.5 right-0.5 cursor-grab overflow-hidden rounded-md border px-1.5 py-1 text-xs ${
                              conflictIds.has(session.id)
                                ? "border-rose-600 bg-rose-50"
                                : "border-slate-200 bg-white"
                            }`}
                            style={{
                              top: (session.offsetMinutes / SLOT_MINUTES) * ROW_PX,
                              height: Math.max(ROW_PX, (session.durationMin / SLOT_MINUTES) * ROW_PX - 2),
                            }}
                          >
                            <span className="flex items-center gap-1">
                              {session.trackColor ? (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: session.trackColor }}
                                  aria-hidden="true"
                                />
                              ) : null}
                              <span className="truncate font-medium text-slate-900">{session.title}</span>
                            </span>
                            <span className="block truncate text-slate-500">
                              {session.publicState === "held" ? "Held from public, " : ""}
                              {session.speakers.map((speaker) => speaker.name).join(", ")}
                            </span>
                            <Link
                              to={hrefWith("place", String(session.id))}
                              className="text-[11px] font-medium text-accent hover:underline"
                            >
                              Move
                            </Link>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Unscheduled ({unscheduled.length})</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">Accepted sessions with no slot yet.</p>
          </div>
          {unscheduled.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">Everything accepted is placed.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {unscheduled.map((session) => (
                <li
                  key={session.id}
                  onPointerDown={(e) => startDrag(session.id, session.title, e)}
                  className="cursor-grab px-4 py-2.5 hover:bg-slate-50"
                >
                  <p className="text-[13px] font-medium text-slate-900">{session.title}</p>
                  <p className="text-[13px] text-slate-500">
                    {session.durationMin} min
                    {session.trackName ? `, ${session.trackName}` : ""}
                  </p>
                  <p className="text-[13px] text-slate-500">
                    {session.speakers.map((speaker) => speaker.name).join(", ") || "No speakers"}
                  </p>
                  <Link to={hrefWith("place", String(session.id))} className="text-[13px] font-medium text-accent hover:underline">
                    Schedule
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dayScheduled.length > 0 ? (
        <Card className="mt-4">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Placed on {formatDayLabel(day, event.timezone)}</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {[...dayScheduled]
              .sort((a, b) => a.offsetMinutes - b.offsetMinutes)
              .map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <p className="text-[13px] text-slate-900">
                    {formatTimeOfDay(session.startsAt, event.timezone)}, {session.roomName}, {session.title}
                  </p>
                  <Form method="post">
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button type="submit" name="intent" value="unplace" className={buttonGhost}>
                      Unschedule
                    </button>
                  </Form>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      {drag ? (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-accent bg-white px-2 py-1 text-xs font-medium text-slate-900 shadow-sm"
          style={{ left: drag.x + 8, top: drag.y + 8 }}
        >
          {drag.title}
        </div>
      ) : null}
    </>
  );
}
