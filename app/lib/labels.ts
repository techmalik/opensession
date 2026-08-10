// Client-safe display labels shared across routes. Keep this file free of any
// .server imports: route components bundle it into the client build.

export const ROLE_LABEL: Record<string, string> = {
  speaker: "Speaker",
  co_speaker: "Co-speaker",
  panelist: "Panelist",
  submitter: "Submitter",
  moderator: "Moderator",
  chairperson: "Chairperson",
};
