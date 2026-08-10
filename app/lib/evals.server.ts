// Scoring math. One definition of "the score of a review" and "the score of a
// submission" used by the submissions table, results view, reviewer queue, and CSV
// exports, so every screen shows the same number.
//
// Rules: stars5 plans store one row per assignment (criterion_id null, score 1..5).
// Rubric plans store one row per criterion; only numeric criteria carry weight, so a
// review scored Originality 4 (weight 2) and Relevance 2 (weight 1) aggregates to
// (4*2 + 2*1) / 3 = 3.33, not the plain average 3.0.

import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { evalAssignments, evalCriteria, evalScores } from "../../database/schema";

export interface CriterionDef {
  id: number;
  planId: number;
  label: string;
  kind: "numeric" | "select" | "text";
  options: string[];
  weight: number;
  sort: number;
}

export async function getCriteria(planId: number): Promise<CriterionDef[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(evalCriteria)
    .where(eq(evalCriteria.planId, planId))
    .orderBy(asc(evalCriteria.sort), asc(evalCriteria.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    planId: row.planId,
    label: row.label,
    kind: row.kind,
    options: safeOptions(row.optionsJson),
    weight: row.weight,
    sort: row.sort,
  }));
}

function safeOptions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export interface ScoreRow {
  criterionId: number | null;
  score: number;
}

/** Weighted score of one review, or null when nothing numeric was recorded.
 *  Rubric reviews aggregate their numeric criteria; a stars5 review is a single
 *  criterion-null row scored 1..5. A criterion-null row scored 0 only carries the
 *  overall comment and never counts as a rating. */
export function reviewScore(rows: ScoreRow[], criteriaById: Map<number, { kind: string; weight: number }>): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const row of rows) {
    if (row.criterionId === null) continue;
    const criterion = criteriaById.get(row.criterionId);
    if (!criterion || criterion.kind !== "numeric") continue;
    const weight = Math.max(1, criterion.weight);
    weighted += row.score * weight;
    totalWeight += weight;
  }
  if (totalWeight > 0) return weighted / totalWeight;

  const overall = rows.find((row) => row.criterionId === null);
  return overall && overall.score > 0 ? overall.score : null;
}

export interface SessionScore {
  avg: number | null;
  count: number; // completed reviews with a numeric score
}

/** Average review score per session across done assignments. Restrict to one plan by
 *  passing planId; otherwise all plans pool together. */
export async function sessionScoreMap(sessionIds: number[], planId?: number): Promise<Map<number, SessionScore>> {
  const result = new Map<number, SessionScore>();
  if (sessionIds.length === 0) return result;

  const db = getDb();
  const assignments = await db
    .select({
      id: evalAssignments.id,
      planId: evalAssignments.planId,
      sessionId: evalAssignments.sessionId,
      status: evalAssignments.status,
    })
    .from(evalAssignments)
    .where(
      planId
        ? eq(evalAssignments.planId, planId)
        : inArray(evalAssignments.sessionId, sessionIds)
    )
    .all();

  const relevant = assignments.filter((a) => a.status === "done" && sessionIds.includes(a.sessionId));
  if (relevant.length === 0) return result;

  const scoreRows = await db
    .select({
      assignmentId: evalScores.assignmentId,
      criterionId: evalScores.criterionId,
      score: evalScores.score,
    })
    .from(evalScores)
    .where(inArray(evalScores.assignmentId, relevant.map((a) => a.id)))
    .all();

  const planIds = [...new Set(relevant.map((a) => a.planId))];
  const criteriaRows = await db
    .select({ id: evalCriteria.id, kind: evalCriteria.kind, weight: evalCriteria.weight })
    .from(evalCriteria)
    .where(inArray(evalCriteria.planId, planIds.length > 0 ? planIds : [-1]))
    .all();
  const criteriaById = new Map(criteriaRows.map((c) => [c.id, { kind: c.kind, weight: c.weight }]));

  const rowsByAssignment = new Map<number, ScoreRow[]>();
  for (const row of scoreRows) {
    const list = rowsByAssignment.get(row.assignmentId) ?? [];
    list.push({ criterionId: row.criterionId, score: row.score });
    rowsByAssignment.set(row.assignmentId, list);
  }

  const perSession = new Map<number, number[]>();
  for (const assignment of relevant) {
    const score = reviewScore(rowsByAssignment.get(assignment.id) ?? [], criteriaById);
    if (score === null) continue;
    const list = perSession.get(assignment.sessionId) ?? [];
    list.push(score);
    perSession.set(assignment.sessionId, list);
  }

  for (const [sessionId, scores] of perSession) {
    result.set(sessionId, {
      avg: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      count: scores.length,
    });
  }
  return result;
}

