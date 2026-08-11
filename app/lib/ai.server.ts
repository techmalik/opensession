// AI agenda assist. Three tiers, in order: the Workers AI binding, an Anthropic API
// key, then a deterministic greedy packer. The fallback is not a degraded mode you
// have to notice: it produces the same shape of proposal, so the feature never 500s
// or renders empty because a key is missing.

import { bindings } from "./db.server";
import type { AssistSource } from "./labels";
import { greedySchedule, type AgendaData, type Placement } from "./agenda.server";
import { slotOffsets, slotTimeValue } from "./agenda-grid";

export type { AssistSource } from "./labels";

/** Workers AI text model. Cloudflare deprecates these on a schedule, so it lives in
 *  one place: `npx wrangler ai models` lists what is current. */
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Models do not agree on a response shape: some return a string, some a
 *  {response: string}, some a {response: object} once they decide to be helpful and
 *  parse their own JSON. Everything downstream wants text. */
export function normalizeAiOutput(output: unknown): string | null {
  if (typeof output === "string") return output;
  const response = (output as { response?: unknown } | null)?.response;
  if (response == null) return null;
  return typeof response === "string" ? response : JSON.stringify(response);
}

export interface AssistResult {
  source: AssistSource;
  placements: Placement[];
  note: string | null;
}

interface AiBinding {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
}

function aiBinding(): AiBinding | null {
  const candidate = (bindings as unknown as { AI?: AiBinding }).AI;
  return candidate && typeof candidate.run === "function" ? candidate : null;
}

function anthropicKey(): string | null {
  return (bindings as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY ?? null;
}

function buildPrompt(data: AgendaData): string {
  const times = slotOffsets()
    .filter((offset) => offset % 30 === 0)
    .map(slotTimeValue);
  const rooms = data.rooms.map((room) => `${room.id}: ${room.name}`).join(", ");
  const busy = data.scheduled
    .filter((s) => s.startsAt)
    .map(
      (s) =>
        `- room ${s.roomId}, ${s.startsAt?.toISOString()} to ${s.endsAt?.toISOString()}, speakers: ${s.speakers
          .map((sp) => sp.name)
          .join("/") || "none"}`
    )
    .join("\n");
  const queue = data.unscheduled
    .map(
      (s) =>
        `- sessionId ${s.id}: "${s.title}" (${s.durationMin} min, track ${s.trackName ?? "none"}, speakers: ${
          s.speakers.map((sp) => sp.name).join("/") || "none"
        })`
    )
    .join("\n");

  return [
    "You are scheduling a conference agenda. Return JSON only.",
    `Timezone: ${data.event.timezone}. Days: ${data.days.join(", ")}. Start times allowed: ${times.join(", ")}.`,
    `Rooms (id: name): ${rooms}`,
    busy ? `Already scheduled:\n${busy}` : "Nothing is scheduled yet.",
    `Place these sessions:\n${queue}`,
    "Rules: no room may hold two sessions at once, no speaker may appear in two overlapping sessions, spread tracks across rooms, longer sessions first.",
    'Respond with {"placements":[{"sessionId":1,"roomId":2,"day":"YYYY-MM-DD","time":"HH:MM","reason":"one short sentence"}]} and nothing else.',
  ].join("\n\n");
}

function extractJson(text: unknown): unknown {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Keeps only placements that name a real session, a real room, a real day, and a
 *  slot on the grid. Anything else is dropped and back-filled by the packer. */
function validate(raw: unknown, data: AgendaData): Placement[] {
  const parsed = raw as { placements?: unknown };
  if (!parsed || !Array.isArray(parsed.placements)) return [];

  const validTimes = new Set(slotOffsets().map(slotTimeValue));
  const roomIds = new Set(data.rooms.map((room) => room.id));
  const days = new Set(data.days);
  const pending = new Map(data.unscheduled.map((s) => [s.id, s]));
  const seen = new Set<number>();
  const result: Placement[] = [];

  for (const entry of parsed.placements as Record<string, unknown>[]) {
    const sessionId = Number(entry?.sessionId);
    const roomId = Number(entry?.roomId);
    const day = String(entry?.day ?? "");
    const time = String(entry?.time ?? "");
    if (!pending.has(sessionId) || seen.has(sessionId)) continue;
    if (!roomIds.has(roomId) || !days.has(day) || !validTimes.has(time)) continue;
    seen.add(sessionId);
    result.push({
      sessionId,
      roomId,
      day,
      time,
      reason: String(entry?.reason ?? "").slice(0, 160) || "Proposed by the scheduling assistant.",
    });
  }
  return result;
}

/** Greedy placements for whatever the model did not cover. */
function backfill(data: AgendaData, accepted: Placement[]): Placement[] {
  const placedIds = new Set(accepted.map((p) => p.sessionId));
  if (placedIds.size === data.unscheduled.length) return accepted;

  const remaining: AgendaData = {
    ...data,
    unscheduled: data.unscheduled.filter((s) => !placedIds.has(s.id)),
    scheduled: [
      ...data.scheduled,
      ...accepted.flatMap((placement) => {
        const session = data.unscheduled.find((s) => s.id === placement.sessionId);
        if (!session) return [];
        const start = new Date(`${placement.day}T${placement.time}:00Z`);
        return [
          {
            ...session,
            roomId: placement.roomId,
            startsAt: start,
            endsAt: new Date(start.getTime() + session.durationMin * 60_000),
          },
        ];
      }),
    ],
  };
  return [...accepted, ...greedySchedule(remaining)];
}

async function runWorkersAi(prompt: string): Promise<string | null> {
  const ai = aiBinding();
  if (!ai) return null;
  try {
    const output = (await ai.run(WORKERS_AI_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    })) as { response?: unknown };
    return normalizeAiOutput(output);
  } catch (err) {
    console.warn("workers ai agenda assist failed", String(err).slice(0, 200));
    return null;
  }
}

async function runAnthropic(prompt: string): Promise<string | null> {
  const key = anthropicKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return data.content?.find((part) => part.type === "text")?.text ?? null;
  } catch {
    return null;
  }
}

export async function proposeSchedule(data: AgendaData): Promise<AssistResult> {
  if (data.unscheduled.length === 0) {
    return { source: "heuristic", placements: [], note: "Every accepted session is already placed." };
  }
  if (data.rooms.length === 0 || data.days.length === 0) {
    return {
      source: "heuristic",
      placements: [],
      note: "Add at least one room and set the event dates before proposing a schedule.",
    };
  }

  const prompt = buildPrompt(data);

  const workersOutput = await runWorkersAi(prompt);
  if (workersOutput) {
    const placements = validate(extractJson(workersOutput), data);
    if (placements.length > 0) {
      const full = backfill(data, placements);
      return {
        source: "workers-ai",
        placements: full,
        note: full.length > placements.length ? "Some slots were filled by the built-in packer." : null,
      };
    }
  }

  const anthropicOutput = await runAnthropic(prompt);
  if (anthropicOutput) {
    const placements = validate(extractJson(anthropicOutput), data);
    if (placements.length > 0) {
      const full = backfill(data, placements);
      return {
        source: "anthropic",
        placements: full,
        note: full.length > placements.length ? "Some slots were filled by the built-in packer." : null,
      };
    }
  }

  const placements = greedySchedule(data);
  return {
    source: "heuristic",
    placements,
    note:
      placements.length < data.unscheduled.length
        ? `${data.unscheduled.length - placements.length} session(s) had no free slot.`
        : null,
  };
}
