// The tools the MCP server exposes, and nothing else. Every one of them delegates:
// reads go through the same loaders the API and the admin screens use, and the two
// writes go through the /api/v1 PATCH handler itself, so the side effect that turns
// an accepted abstract into a schedulable session cannot drift out of step.

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { paginate, type Page } from "./api.server";
import { filterApiSessions, loadApiSessions, type SessionQuery } from "./api-sessions.server";
import { querySubmissions } from "./submissions.server";
import { querySpeakers } from "./speakers.server";
import { loadAgenda } from "./agenda.server";
import { deliverableMatrix, taskMatrix } from "./tasks.server";
import { scopedEvent, scopedEvents, type TokenScope } from "./token-scope.server";
import { rooms, sessions, tracks } from "../../database/schema";
import { action as apiSessionAction } from "../routes/api.session";

// The route module is typed against React Router's generated ActionArgs. Calling it
// in process needs nothing more than the request and the two path params.
type SessionPatch = (args: {
  request: Request;
  params: { eventId: string; sessionId: string };
}) => Promise<Response>;
const patchApiSession = apiSessionAction as unknown as SessionPatch;

export interface McpContext {
  /** The plaintext token, replayed on the delegated API call. */
  token: string;
  origin: string;
  scope: TokenScope;
}

/** A failure the caller can act on: reported as an MCP tool error, not a transport
 *  error, so the agent sees the message and keeps its session. */
export class ToolError extends Error {}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run: (input: Record<string, unknown>, context: McpContext) => Promise<unknown>;
}

// ---------- input helpers ----------

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function num(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredNum(input: Record<string, unknown>, key: string): number {
  const value = num(input, key);
  if (value == null) throw new ToolError(`"${key}" is required and must be a number.`);
  return value;
}

function readPageInput(input: Record<string, unknown>): Page {
  return {
    page: Math.max(1, num(input, "page") ?? 1),
    pageSize: Math.min(100, Math.max(1, num(input, "pageSize") ?? 25)),
  };
}

async function requireEvent(context: McpContext, input: Record<string, unknown>) {
  const eventId = requiredNum(input, "eventId");
  const event = await scopedEvent(context.scope, eventId);
  if (!event) {
    throw new ToolError(
      `No event ${eventId} is available to this token. Call list_events to see what it can reach.`
    );
  }
  return event;
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** "Accept Queue", "accept queue", and "accept_queue" all mean the same status. */
function statusKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Tracks and rooms are addressed by name in these tools, because an agent reading a
 *  session sees names, not ids. An id is still accepted. */
function pickByNameOrId(rows: { id: number; name: string }[], value: string, label: string): number {
  const asId = Number(value);
  const match = Number.isInteger(asId)
    ? rows.find((row) => row.id === asId)
    : rows.find((row) => row.name.toLowerCase() === value.trim().toLowerCase());
  if (!match) {
    throw new ToolError(`No ${label} "${value}" on this event. Available: ${rows.map((row) => row.name).join(", ")}.`);
  }
  return match.id;
}

async function trackIdFor(eventId: number, value: string): Promise<number> {
  const rows = await getDb()
    .select({ id: tracks.id, name: tracks.name })
    .from(tracks)
    .where(eq(tracks.eventId, eventId))
    .orderBy(asc(tracks.sort), asc(tracks.id))
    .all();
  return pickByNameOrId(rows, value, "track");
}

async function roomIdFor(eventId: number, value: string): Promise<number> {
  const rows = await getDb()
    .select({ id: rooms.id, name: rooms.name })
    .from(rooms)
    .where(eq(rooms.eventId, eventId))
    .orderBy(asc(rooms.sort), asc(rooms.id))
    .all();
  return pickByNameOrId(rows, value, "room");
}

/** The one write path. Everything that changes a session goes through the public
 *  API's own PATCH handler, with this token, so validation and the accepted ->
 *  session side effect stay in exactly one place. */
async function patchSession(
  context: McpContext,
  eventId: number,
  sessionId: number,
  body: Record<string, unknown>
): Promise<unknown> {
  const request = new Request(`${context.origin}/api/v1/event/${eventId}/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "x-access-token": context.token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await patchApiSession({
    request,
    params: { eventId: String(eventId), sessionId: String(sessionId) },
  });
  const payload = (await response.json()) as { data?: unknown; error?: { message?: string } };
  if (!response.ok) throw new ToolError(payload.error?.message ?? `The API rejected that change (${response.status}).`);
  return payload.data;
}

async function requireSession(eventId: number, sessionId: number) {
  const row = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)))
    .get();
  if (!row) throw new ToolError(`No session ${sessionId} on event ${eventId}.`);
  return row;
}

/** Moves a submission to a decision status. Neither decision sends email: that stays
 *  the explicit Communications step, which is where the templates and the .ics live. */
async function decide(
  context: McpContext,
  input: Record<string, unknown>,
  finalKey: "accepted" | "declined",
  queueKey: "accept_queue" | "decline_queue"
) {
  const event = await requireEvent(context, input);
  const sessionId = requiredNum(input, "sessionId");
  await requireSession(event.id, sessionId);

  const queue = input.queue === true;
  const key = queue ? queueKey : finalKey;
  const data = await patchSession(context, event.id, sessionId, { status: key });

  return {
    session: data,
    status: key,
    emailSent: false,
    note: queue
      ? "Queued. Send the decision email from Communications, Send decisions."
      : "Status set. No decision email was sent; use Communications, Send decisions to notify the speaker.",
  };
}

// ---------- tools ----------

export const TOOLS: ToolDef[] = [
  {
    name: "list_events",
    title: "List events",
    description:
      "Every event this token can reach, newest first. Start here: the event id it returns is the eventId every other tool needs.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_input, context) => {
      const rows = await scopedEvents(context.scope);
      return {
        events: rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status,
          location: row.location,
          timezone: row.timezone,
          startsAt: iso(row.startsAt),
          endsAt: iso(row.endsAt),
          agendaPublishedAt: iso(row.agendaPublishedAt),
        })),
        total: rows.length,
      };
    },
  },

  {
    name: "search_sessions",
    title: "Search sessions",
    description:
      "Search an event's sessions and submissions. Filters combine: free text over title, abstract, code, and speaker names, plus status key, track name, format name, room name, and whether the session is scheduled.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer", description: "Event id from list_events." },
        text: { type: "string", description: "Free text over title, abstract, code, and speaker names." },
        status: { type: "string", description: "Status key or label: pending, accept_queue, accepted, decline_queue, declined." },
        track: { type: "string", description: "Track name, exactly as it appears on the event." },
        format: { type: "string", description: "Format name, for example \"Workshop (120 min)\"." },
        room: { type: "string", description: "Room name." },
        scheduled: { type: "boolean", description: "True for sessions that have a room and a start time." },
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["eventId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const rows = await loadApiSessions(event.id);
      const status = str(input, "status");
      const query: SessionQuery = {
        q: str(input, "text"),
        status: status ? statusKey(status) : undefined,
        track: str(input, "track"),
        format: str(input, "format"),
        room: str(input, "room"),
        scheduled: typeof input.scheduled === "boolean" ? input.scheduled : undefined,
      };
      return paginate(filterApiSessions(rows, query), readPageInput(input));
    },
  },

  {
    name: "get_session",
    title: "Get session",
    description: "One session with its speakers, status, track, format, room, and schedule.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        sessionId: { type: "integer" },
      },
      required: ["eventId", "sessionId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const sessionId = requiredNum(input, "sessionId");
      const [row] = await loadApiSessions(event.id, [sessionId]);
      if (!row) throw new ToolError(`No session ${sessionId} on event ${event.id}.`);
      return { session: row };
    },
  },

  {
    name: "update_session",
    title: "Update session",
    description:
      "Change a session's title, abstract, status, track, room, or scheduled time. Track and room take a name or an id. Times are ISO 8601. Setting the status to accepted turns a submission into a schedulable session; no email is sent.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        sessionId: { type: "integer" },
        title: { type: "string" },
        abstract: { type: "string" },
        status: { type: "string", description: "pending, accept_queue, accepted, decline_queue, or declined." },
        track: { type: "string", description: "Track name or id." },
        room: { type: "string", description: "Room name or id." },
        startsAt: { type: "string", description: "ISO 8601 instant, for example 2027-06-10T17:00:00Z." },
        endsAt: { type: "string", description: "ISO 8601 instant." },
      },
      required: ["eventId", "sessionId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const sessionId = requiredNum(input, "sessionId");
      await requireSession(event.id, sessionId);

      const body: Record<string, unknown> = {};
      if ("title" in input) body.title = str(input, "title") ?? "";
      if ("abstract" in input) body.abstract = input.abstract == null ? null : String(input.abstract);
      const status = str(input, "status");
      if (status) body.status = statusKey(status);
      const track = str(input, "track");
      if (track) body.trackId = await trackIdFor(event.id, track);
      const room = str(input, "room");
      if (room) body.roomId = await roomIdFor(event.id, room);
      if ("startsAt" in input) body.startsAt = input.startsAt == null ? null : String(input.startsAt);
      if ("endsAt" in input) body.endsAt = input.endsAt == null ? null : String(input.endsAt);

      if (Object.keys(body).length === 0) throw new ToolError("Pass at least one field to change.");
      return { session: await patchSession(context, event.id, sessionId, body) };
    },
  },

  {
    name: "list_speakers",
    title: "List speakers",
    description:
      "The event's speaker roster with confirmation status, session titles, and task and file completion counts.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        text: { type: "string", description: "Free text over name, email, and company." },
        status: { type: "string", description: "invited, confirmed, or declined." },
        flag: {
          type: "string",
          description: "accepted, no_headshot, no_bio, tasks_incomplete, or files_incomplete.",
        },
      },
      required: ["eventId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const rows = await querySpeakers(event.id, {
        q: str(input, "text"),
        status: str(input, "status"),
        flag: str(input, "flag"),
      });
      return {
        total: rows.length,
        speakers: rows.map((row) => ({
          contactId: row.contactId,
          name: row.name,
          email: row.email,
          title: row.title,
          company: row.company,
          status: row.status,
          acceptedSessions: row.acceptedCount,
          tasks: `${row.tasksDone}/${row.tasksTotal}`,
          files: `${row.filesDone}/${row.filesTotal}`,
        })),
      };
    },
  },

  {
    name: "get_speaker",
    title: "Get speaker",
    description: "One speaker with their bio, sessions, and outstanding task and file counts.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        contactId: { type: "integer" },
      },
      required: ["eventId", "contactId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const contactId = requiredNum(input, "contactId");
      const row = (await querySpeakers(event.id, {})).find((speaker) => speaker.contactId === contactId);
      if (!row) throw new ToolError(`No speaker ${contactId} on event ${event.id}.`);
      return {
        speaker: {
          contactId: row.contactId,
          name: row.name,
          email: row.email,
          title: row.title,
          company: row.company,
          bio: row.bio,
          hasHeadshot: row.headshotBlobKey != null,
          status: row.status,
          sessions: row.sessionTitles,
          acceptedSessions: row.acceptedCount,
          tasks: { done: row.tasksDone, total: row.tasksTotal },
          files: { done: row.filesDone, total: row.filesTotal },
        },
      };
    },
  },

  {
    name: "list_submissions_by_status",
    title: "List submissions by status",
    description:
      "The submissions queue for one status, with review score averages. Statuses are pending, accept_queue, accepted, decline_queue, and declined.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        status: { type: "string", description: "Status key. Omit for every submission." },
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["eventId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const status = str(input, "status");
      const rows = await querySubmissions(event.id, { statusKey: status ? statusKey(status) : undefined });
      return paginate(
        rows.map((row) => ({
          id: row.id,
          code: row.friendlyId,
          title: row.title,
          status: row.statusKey,
          statusLabel: row.statusLabel,
          track: row.trackName,
          format: row.formatName,
          speakers: row.speakers,
          scoreAvg: row.scoreAvg,
          scoreCount: row.scoreCount,
          isScheduled: row.isScheduled,
          submittedAt: iso(row.submittedAt),
          decisionEmailSentAt: iso(row.decisionEmailSentAt),
        })),
        readPageInput(input)
      );
    },
  },

  {
    name: "accept_submission",
    title: "Accept submission",
    description:
      "Set a submission to Accepted, which turns it into a session that can be scheduled on the agenda. Pass queue: true to put it in the Accept Queue instead and leave the decision email for the organizer. No email is sent either way.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        sessionId: { type: "integer" },
        queue: { type: "boolean", description: "True moves it to Accept Queue rather than Accepted." },
      },
      required: ["eventId", "sessionId"],
      additionalProperties: false,
    },
    run: (input, context) => decide(context, input, "accepted", "accept_queue"),
  },

  {
    name: "decline_submission",
    title: "Decline submission",
    description:
      "Set a submission to Declined, optionally recording feedback for the speaker on the submission's decline feedback field. Pass queue: true to put it in the Decline Queue instead; note that the Send decisions screen writes its own note at send time. No email is sent.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        sessionId: { type: "integer" },
        feedback: { type: "string", description: "Optional plain-text note stored on the submission." },
        queue: { type: "boolean", description: "True moves it to Decline Queue rather than Declined." },
      },
      required: ["eventId", "sessionId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const result = await decide(context, input, "declined", "decline_queue");
      const feedback = str(input, "feedback");
      if (feedback) {
        const eventId = requiredNum(input, "eventId");
        const sessionId = requiredNum(input, "sessionId");
        await getDb()
          .update(sessions)
          .set({ declineFeedback: feedback, updatedAt: new Date() })
          .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));
      }
      return { ...result, feedback: feedback ?? null };
    },
  },

  {
    name: "get_agenda",
    title: "Get agenda",
    description:
      "The event agenda: rooms, days, every scheduled session with its slot, everything still unscheduled, and the room and speaker double-bookings the organizer screen surfaces.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "integer" } },
      required: ["eventId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const data = await loadAgenda(event.id);
      return {
        event: { id: data.event.id, name: data.event.name, timezone: data.event.timezone },
        days: data.days,
        rooms: data.rooms,
        scheduled: data.scheduled.map((row) => ({
          id: row.id,
          code: row.friendlyId,
          title: row.title,
          room: row.roomName,
          startsAt: iso(row.startsAt),
          endsAt: iso(row.endsAt),
          track: row.trackName,
          publicState: row.publicState,
          speakers: row.speakers.map((speaker) => speaker.name),
        })),
        unscheduled: data.unscheduled.map((row) => ({
          id: row.id,
          code: row.friendlyId,
          title: row.title,
          durationMin: row.durationMin,
          speakers: row.speakers.map((speaker) => speaker.name),
        })),
        conflicts: data.conflicts,
      };
    },
  },

  {
    name: "list_open_tasks",
    title: "List open tasks",
    description:
      "Speaker tasks and file requests that are still outstanding, one row per speaker and item, marked todo or overdue.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "integer" },
        contactId: { type: "integer", description: "Limit to one speaker." },
        kind: { type: "string", enum: ["all", "task", "file_request"], description: "Defaults to all." },
      },
      required: ["eventId"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const event = await requireEvent(context, input);
      const contactId = num(input, "contactId");
      const kind = str(input, "kind") ?? "all";

      const open: {
        kind: "task" | "file_request";
        id: number;
        title: string;
        contactId: number;
        speaker: string;
        status: string;
        dueAt: string | null;
      }[] = [];

      if (kind === "all" || kind === "task") {
        const matrix = await taskMatrix(event.id);
        const names = new Map(matrix.speakers.map((speaker) => [speaker.contactId, speaker.name]));
        for (const cell of matrix.cells) {
          if (cell.status === "done") continue;
          if (contactId != null && cell.contactId !== contactId) continue;
          const task = matrix.tasks.find((row) => row.id === cell.taskId);
          if (!task) continue;
          open.push({
            kind: "task",
            id: task.id,
            title: task.title,
            contactId: cell.contactId,
            speaker: names.get(cell.contactId) ?? String(cell.contactId),
            status: cell.status,
            dueAt: iso(task.dueAt),
          });
        }
      }

      if (kind === "all" || kind === "file_request") {
        const matrix = await deliverableMatrix(event.id);
        const names = new Map(matrix.speakers.map((speaker) => [speaker.contactId, speaker.name]));
        for (const cell of matrix.cells) {
          if (cell.status === "done") continue;
          if (contactId != null && cell.contactId !== contactId) continue;
          const request = matrix.requests.find((row) => row.id === cell.requestId);
          if (!request) continue;
          open.push({
            kind: "file_request",
            id: request.id,
            title: request.title,
            contactId: cell.contactId,
            speaker: names.get(cell.contactId) ?? String(cell.contactId),
            status: cell.status,
            dueAt: iso(request.dueAt),
          });
        }
      }

      return { total: open.length, overdue: open.filter((row) => row.status === "overdue").length, open };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
