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

export type Approval = "pending" | "approved" | "denied";

export const APPROVAL_LABEL: Record<Approval, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
};
