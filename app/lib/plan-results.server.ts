// Aggregation for one plan's results table and its CSV export: identical numbers in
// both places because they come from here.

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { getCriteria, reviewScore, type CriterionDef } from "./evals.server";
import { evalAssignments, evalScores, sessions, statuses, tracks } from "../../database/schema";

export interface PlanResultRow {
  sessionId: number;
  friendlyId: string;
  title: string;
  trackName: string | null;
  statusKey: string | null;
  statusLabel: string | null;
  reviewCount: number;
  avg: number | null;
  criterionAvgs: Record<number, number>;
}

export async function loadPlanResults(
  eventId: number,
  planId: number,
  dir: "asc" | "desc"
): Promise<{ rows: PlanResultRow[]; criteria: CriterionDef[] }> {
  const db = getDb();
  const criteria = await getCriteria(planId);
  const criteriaById = new Map(criteria.map((c) => [c.id, { kind: c.kind, weight: c.weight }]));

  const done = await db
    .select({ id: evalAssignments.id, sessionId: evalAssignments.sessionId })
    .from(evalAssignments)
    .where(and(eq(evalAssignments.planId, planId), eq(evalAssignments.status, "done")))
    .all();
  if (done.length === 0) return { rows: [], criteria };

  const scoreRows = await db
    .select({ assignmentId: evalScores.assignmentId, criterionId: evalScores.criterionId, score: evalScores.score })
    .from(evalScores)
    .where(inArray(evalScores.assignmentId, done.map((a) => a.id)))
    .all();

  const sessionIds = [...new Set(done.map((a) => a.sessionId))];
  const sessionRows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      trackName: tracks.name,
      statusKey: statuses.key,
      statusLabel: statuses.label,
    })
    .from(sessions)
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(inArray(sessions.id, sessionIds))
    .all();

  const rows: PlanResultRow[] = sessionRows.map((session) => {
    const assignmentIds = done.filter((a) => a.sessionId === session.id).map((a) => a.id);
    const perAssignment = assignmentIds
      .map((id) =>
        reviewScore(
          scoreRows.filter((s) => s.assignmentId === id).map((s) => ({ criterionId: s.criterionId, score: s.score })),
          criteriaById
        )
      )
      .filter((score): score is number => score != null);

    const criterionAvgs: Record<number, number> = {};
    for (const criterion of criteria) {
      if (criterion.kind !== "numeric") continue;
      const values = scoreRows
        .filter((s) => s.criterionId === criterion.id && assignmentIds.includes(s.assignmentId))
        .map((s) => s.score);
      if (values.length > 0) criterionAvgs[criterion.id] = values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    return {
      sessionId: session.id,
      friendlyId: session.friendlyId,
      title: session.title,
      trackName: session.trackName,
      statusKey: session.statusKey,
      statusLabel: session.statusLabel,
      reviewCount: assignmentIds.length,
      avg: perAssignment.length > 0 ? perAssignment.reduce((sum, v) => sum + v, 0) / perAssignment.length : null,
      criterionAvgs,
    };
  });

  rows.sort((a, b) => {
    const av = a.avg ?? -Infinity;
    const bv = b.avg ?? -Infinity;
    if (av === bv) return a.sessionId - b.sessionId;
    return dir === "asc" ? av - bv : bv - av;
  });

  return { rows, criteria };
}
