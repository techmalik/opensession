// AI first-pass review. Three personas read a submission and each return a score
// with written reasoning, stored in ai_reviews and rendered in their own panel.
//
// These never touch a human aggregate. A program committee's average has to mean
// "what the humans thought", so AI output sits alongside it, labelled, and the
// organizer decides what to do with it.
//
// Same three tiers as the agenda assist: the Workers AI binding, then
// ANTHROPIC_API_KEY, then a heuristic that says out loud that it is a heuristic.

import { and, desc, eq, inArray } from "drizzle-orm";
import { bindings, getDb } from "./db.server";
import { AI_PERSONAS, REVIEW_SOURCE_LABEL, type AiPersonaKey, type AssistSource } from "./labels";
import { normalizeAiOutput, WORKERS_AI_MODEL } from "./ai.server";
import { aiReviews, formats, sessions, tracks } from "../../database/schema";

export interface AiReviewRow {
  id: number;
  sessionId: number;
  persona: string;
  personaLabel: string;
  /** What the model (or the heuristic) actually said. Never overwritten. */
  score: number;
  reviewText: string;
  source: AssistSource;
  createdAt: Date;
  overrideScore: number | null;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideAt: Date | null;
  /** The number every average uses: the override when there is one. */
  effectiveScore: number;
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

interface SubmissionInput {
  id: number;
  title: string;
  abstract: string;
  trackName: string | null;
  formatName: string | null;
}

function buildPrompt(persona: (typeof AI_PERSONAS)[number], submission: SubmissionInput): string {
  return [
    `You are reviewing a conference talk proposal as "${persona.label}". ${persona.brief}`,
    `Title: ${submission.title}`,
    `Track: ${submission.trackName ?? "not set"}. Format: ${submission.formatName ?? "not set"}.`,
    `Abstract: ${submission.abstract || "(no abstract was submitted)"}`,
    "Score it 1 to 5, where 3 is a solid but unremarkable talk.",
    "Your reasoning must quote or name something specific from this abstract. Two to four sentences. No preamble.",
    'Respond with {"score":4,"reasoning":"..."} and nothing else.',
  ].join("\n\n");
}

function extractJson(text: unknown): { score?: unknown; reasoning?: unknown } | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as { score?: unknown; reasoning?: unknown };
  } catch {
    return null;
  }
}

/** A model may return 7, or "4/5", or a paragraph. Only a usable pair survives. */
function validate(raw: unknown): { score: number; reasoning: string } | null {
  const parsed = raw as { score?: unknown; reasoning?: unknown } | null;
  if (!parsed) return null;
  const score = Math.round(Number(parsed.score));
  const reasoning = String(parsed.reasoning ?? "").trim();
  if (!Number.isInteger(score) || score < 1 || score > 5) return null;
  if (reasoning.length < 20) return null;
  return { score, reasoning: reasoning.slice(0, 1200) };
}

async function runWorkersAi(prompt: string): Promise<string | null> {
  const ai = aiBinding();
  if (!ai) return null;
  try {
    const output = (await ai.run(WORKERS_AI_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
    })) as { response?: unknown } | string;
    return normalizeAiOutput(output);
  } catch (err) {
    // Swallowed on purpose, the heuristic covers it, but a silent fallback is
    // impossible to diagnose without this line.
    console.warn("workers ai review failed", String(err).slice(0, 200));
    return null;
  }
}

async function runAnthropic(prompt: string): Promise<string | null> {
  const key = anthropicKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.warn("anthropic review failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { content?: { text?: string }[] };
    return data.content?.map((part) => part.text ?? "").join("") || null;
  } catch (err) {
    console.warn("anthropic review threw", String(err).slice(0, 200));
    return null;
  }
}

/** Deterministic fallback. It reads the actual abstract rather than emitting one
 *  fixed paragraph, and it is labelled a heuristic everywhere it surfaces, because
 *  a fake review presented as a model's opinion would be worse than none. */
function heuristicReview(
  persona: (typeof AI_PERSONAS)[number],
  submission: SubmissionInput
): { score: number; reasoning: string } {
  const abstract = submission.abstract.trim();
  const words = abstract.split(/\s+/).filter(Boolean).length;
  const sentences = abstract.split(/[.!?]+/).filter((part) => part.trim().length > 0).length;
  const hasNumbers = /\d/.test(abstract);
  const hasOutcome = /(result|outcome|learn|takeaway|we (built|shipped|found|cut|reduced))/i.test(abstract);
  const hasSpecifics = /(because|instead|failed|mistake|tradeoff|trade-off|however)/i.test(abstract);

  let score = 3;
  const notes: string[] = [];

  if (words < 25) {
    score -= 1;
    notes.push(`the abstract runs to ${words} words, too thin to judge the substance`);
  } else if (words > 60) {
    notes.push(`the abstract gives ${words} words and ${sentences} sentences of detail to work from`);
  }
  if (hasNumbers) {
    score += 1;
    notes.push("it cites concrete figures rather than describing the shape of a result");
  } else {
    notes.push("nothing in it is quantified, so the scale of the claim is unclear");
  }
  if (hasOutcome) {
    score += persona.key === "audience_advocate" ? 1 : 0;
    notes.push("an attendee can tell what they would leave with");
  } else if (persona.key === "audience_advocate") {
    score -= 1;
    notes.push("it never says what an attendee walks away able to do");
  }
  if (persona.key === "skeptic") {
    if (hasSpecifics) notes.push("it admits at least one tradeoff, which is rarer than it should be");
    else {
      score -= 1;
      notes.push("it reads as an unbroken success story, with no failure or tradeoff named");
    }
  }
  if (persona.key === "track_expert" && !submission.trackName) {
    score -= 1;
    notes.push("no track is set, so it cannot be placed against the rest of the programme");
  }

  score = Math.max(1, Math.min(5, score));
  const title = submission.title || "This submission";
  return {
    score,
    reasoning:
      `Heuristic assessment, no language model was available. Reading "${title}" as ${persona.label.toLowerCase()}: ` +
      `${notes.join("; ")}.`,
  };
}

async function loadSubmission(eventId: number, sessionId: number): Promise<SubmissionInput | null> {
  const db = getDb();
  const row = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      abstract: sessions.abstract,
      trackName: tracks.name,
      formatName: formats.name,
    })
    .from(sessions)
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .leftJoin(formats, eq(sessions.formatId, formats.id))
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)))
    .get();
  if (!row) return null;
  return { ...row, abstract: row.abstract ?? "" };
}

export interface RunResult {
  sessionId: number;
  created: number;
  source: AssistSource;
}

/** Runs all three personas over one submission, replacing any previous AI pass so
 *  the panel never stacks up duplicates from repeated clicks. A re-run is a fresh
 *  pass, so any overrides on the previous pass go with it. */
export async function runAiReview(eventId: number, sessionId: number): Promise<RunResult | null> {
  const submission = await loadSubmission(eventId, sessionId);
  if (!submission) return null;

  const db = getDb();
  const now = new Date();
  const written: { persona: string; score: number; reviewText: string }[] = [];
  let source: AssistSource = "heuristic";

  for (const persona of AI_PERSONAS) {
    const prompt = buildPrompt(persona, submission);

    const workersRaw = await runWorkersAi(prompt);
    let verdict = validate(extractJson(workersRaw ?? ""));
    if (verdict) source = "workers-ai";
    else if (workersRaw) console.warn("workers ai returned unusable review output", workersRaw.slice(0, 200));

    if (!verdict) {
      const anthropicRaw = await runAnthropic(prompt);
      verdict = validate(extractJson(anthropicRaw ?? ""));
      if (verdict) source = "anthropic";
      else if (anthropicRaw) console.warn("anthropic returned unusable review output", anthropicRaw.slice(0, 200));
    }
    if (!verdict) verdict = heuristicReview(persona, submission);

    written.push({ persona: persona.key, score: verdict.score, reviewText: verdict.reasoning });
  }

  await db.delete(aiReviews).where(eq(aiReviews.sessionId, sessionId));
  for (const row of written) {
    await db.insert(aiReviews).values({
      sessionId,
      // The source rides with the persona key so the UI can label a heuristic pass
      // without a schema change.
      persona: `${row.persona}:${source}`,
      score: row.score,
      reviewText: row.reviewText,
      createdAt: now,
    });
  }

  return { sessionId, created: written.length, source };
}

function splitPersona(stored: string): { key: string; source: AssistSource } {
  const [key, source] = stored.split(":");
  return { key, source: (source as AssistSource) ?? "heuristic" };
}

export async function listAiReviews(sessionId: number): Promise<AiReviewRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(aiReviews)
    .where(eq(aiReviews.sessionId, sessionId))
    .orderBy(desc(aiReviews.createdAt), desc(aiReviews.id))
    .all();

  return rows.map((row) => {
    const { key, source } = splitPersona(row.persona);
    return {
      id: row.id,
      sessionId: row.sessionId,
      persona: key,
      personaLabel: AI_PERSONAS.find((p) => p.key === key)?.label ?? key,
      score: row.score,
      reviewText: row.reviewText,
      source,
      createdAt: row.createdAt,
      overrideScore: row.overrideScore,
      overrideReason: row.overrideReason,
      overrideBy: row.overrideBy,
      overrideAt: row.overrideAt,
      effectiveScore: row.overrideScore ?? row.score,
    };
  });
}

/** ABS-14: an organizer replaces one persona's score with their own judgement.
 *  The model's number stays in the row, so the panel shows both and the reason the
 *  human gave. Human evaluation aggregates are a different table entirely and are
 *  untouched by this. */
export async function setAiReviewOverride(
  sessionId: number,
  reviewId: number,
  score: number,
  reason: string,
  by: string
): Promise<boolean> {
  if (!Number.isInteger(score) || score < 1 || score > 5) return false;
  const db = getDb();
  // Scoped to the session so a reviewId from another submission cannot be edited.
  const row = await db
    .select({ id: aiReviews.id })
    .from(aiReviews)
    .where(and(eq(aiReviews.id, reviewId), eq(aiReviews.sessionId, sessionId)))
    .get();
  if (!row) return false;

  await db
    .update(aiReviews)
    .set({
      overrideScore: score,
      overrideReason: reason.trim().slice(0, 200) || null,
      overrideBy: by,
      overrideAt: new Date(),
    })
    .where(eq(aiReviews.id, row.id));
  return true;
}

export async function clearAiReviewOverride(sessionId: number, reviewId: number): Promise<boolean> {
  const db = getDb();
  const row = await db
    .select({ id: aiReviews.id })
    .from(aiReviews)
    .where(and(eq(aiReviews.id, reviewId), eq(aiReviews.sessionId, sessionId)))
    .get();
  if (!row) return false;

  await db
    .update(aiReviews)
    .set({ overrideScore: null, overrideReason: null, overrideBy: null, overrideAt: null })
    .where(eq(aiReviews.id, row.id));
  return true;
}

/** AI averages for the submissions table, kept in their own column so nobody can
 *  mistake one for a committee score. */
export async function aiScoreMap(sessionIds: number[]): Promise<Map<number, { avg: number; count: number }>> {
  const result = new Map<number, { avg: number; count: number }>();
  if (sessionIds.length === 0) return result;

  const db = getDb();
  const rows = await db.select().from(aiReviews).where(inArray(aiReviews.sessionId, sessionIds)).all();
  for (const sessionId of sessionIds) {
    const mine = rows.filter((row) => row.sessionId === sessionId);
    if (mine.length === 0) continue;
    result.set(sessionId, {
      // Overrides win here too, so the submissions table and the detail panel
      // never disagree about the AI average.
      avg: mine.reduce((sum, row) => sum + (row.overrideScore ?? row.score), 0) / mine.length,
      count: mine.length,
    });
  }
  return result;
}

export async function clearAiReviews(sessionId: number): Promise<void> {
  const db = getDb();
  await db.delete(aiReviews).where(eq(aiReviews.sessionId, sessionId));
}
