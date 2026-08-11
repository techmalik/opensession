// Client-safe display labels and shared unions. Keep this file free of any
// .server imports: route components bundle it into the client build.

export const ROLE_LABEL: Record<string, string> = {
  speaker: "Speaker",
  co_speaker: "Co-speaker",
  panelist: "Panelist",
  submitter: "Submitter",
  moderator: "Moderator",
  chairperson: "Chairperson",
};

/** Roster workflow status, distinct from a submission's decision status. */
export type SpeakerStatus = "invited" | "confirmed" | "declined";

export const SPEAKER_STATUS_LABEL: Record<SpeakerStatus, string> = {
  invited: "Invited",
  confirmed: "Confirmed",
  declined: "Declined",
};

/** Who a portal task or file request applies to. */
export type Audience = "all_speakers" | "accepted_speakers" | "selected";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  all_speakers: "All speakers",
  accepted_speakers: "Speakers with an accepted session",
  selected: "Selected speakers",
};

/** Which tier produced an agenda proposal. */
export type AssistSource = "workers-ai" | "anthropic" | "heuristic";

export const ASSIST_SOURCE_LABEL: Record<AssistSource, string> = {
  "workers-ai": "Workers AI",
  anthropic: "Anthropic API",
  heuristic: "Built-in scheduler",
};

/** Same tiers, different feature: "scheduler" is the wrong noun on a review. */
export const REVIEW_SOURCE_LABEL: Record<AssistSource, string> = {
  "workers-ai": "Workers AI",
  anthropic: "Anthropic API",
  heuristic: "Built-in heuristic, no model available",
};

/** Whether a session is allowed on the public agenda, the embed widgets, and the
 *  iCal feed. Independent of its decision status: an accepted, scheduled session can
 *  still be held back. */
export type PublicState = "published" | "held";

export const PUBLIC_STATE_LABEL: Record<PublicState, string> = {
  published: "Published",
  held: "Held from public",
};

export function isPublicState(value: unknown): value is PublicState {
  return value === "published" || value === "held";
}

/** The three AI reviewer personas. Deliberately different lenses: a panel that
 *  agrees with itself is worth one opinion, not three. */
export type AiPersonaKey = "track_expert" | "audience_advocate" | "skeptic";

export const AI_PERSONAS: { key: AiPersonaKey; label: string; brief: string }[] = [
  {
    key: "track_expert",
    label: "Track expert",
    brief: "You know this subject deeply. Judge technical depth, novelty, and whether it fits the track it was submitted to.",
  },
  {
    key: "audience_advocate",
    label: "Audience advocate",
    brief: "You represent the attendee. Judge clarity, what someone walks away able to do, and whether the abstract promises something worth an hour.",
  },
  {
    key: "skeptic",
    label: "Skeptic",
    brief: "You look for the weak seam: overclaiming, vendor pitch, missing evidence, or a talk that is really a product demo.",
  },
];

export type Approval = "pending" | "approved" | "denied";

export const APPROVAL_LABEL: Record<Approval, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
};
