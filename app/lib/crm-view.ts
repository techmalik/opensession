// Client-safe CRM constants. Route components bundle this, so it must not import a
// .server module. crm.server.ts imports and re-exports the type.

export type CrmStage = "researching" | "identified" | "contacted" | "interested" | "confirmed" | "declined";

/** The sourcing lifecycle: four open stages, then the two terminal ones. */
export const CRM_STAGES: { key: CrmStage; label: string; terminal?: boolean }[] = [
  { key: "researching", label: "Researching" },
  { key: "identified", label: "Identified" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "confirmed", label: "Confirmed", terminal: true },
  { key: "declined", label: "Declined", terminal: true },
];

export const STAGE_LABEL: Record<CrmStage, string> = {
  researching: "Researching",
  identified: "Identified",
  contacted: "Contacted",
  interested: "Interested",
  confirmed: "Confirmed",
  declined: "Declined",
};

export function isCrmStage(value: unknown): value is CrmStage {
  return typeof value === "string" && value in STAGE_LABEL;
}

export const CRM_NAV: { to: string; label: string }[] = [
  { to: "/crm", label: "Overview" },
  { to: "/crm/contacts", label: "Directory" },
  { to: "/crm/pipeline", label: "Pipeline" },
  { to: "/crm/segments", label: "Segments" },
  { to: "/crm/fields", label: "Fields" },
];
