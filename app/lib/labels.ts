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

export type Approval = "pending" | "approved" | "denied";

export const APPROVAL_LABEL: Record<Approval, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
};
