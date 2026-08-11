// Client-safe half of the command palette: the screen list and the result shape.
// The palette component bundles whatever this imports, so nothing here may reach a
// .server module (same rule as labels.ts and agenda-grid.ts).

export interface PaletteScreen {
  to: string;
  label: string;
  hint: string;
}

/** Every organizer screen the palette can jump to, including the ones that are one
 *  level below the sidebar. Ordered the way the sidebar is, so the list reads as the
 *  product rather than as an index. */
export function paletteScreens(base: string): PaletteScreen[] {
  return [
    { to: base, label: "Dashboard", hint: "Event overview" },
    { to: `${base}/submissions`, label: "Submissions", hint: "Abstracts and sessions" },
    { to: `${base}/submissions/new`, label: "Add submission", hint: "Submissions" },
    { to: `${base}/submissions/send-decisions`, label: "Send decision emails", hint: "Submissions" },
    { to: `${base}/forms`, label: "Forms", hint: "Call for papers" },
    { to: `${base}/evaluations`, label: "Evaluations", hint: "Review plans and scores" },
    { to: `${base}/agenda`, label: "Agenda", hint: "Schedule grid" },
    { to: `${base}/agenda/assist`, label: "AI agenda assist", hint: "Agenda" },
    { to: `${base}/speakers`, label: "Speakers", hint: "Event roster" },
    { to: `${base}/speakers/import`, label: "Import speakers", hint: "Speakers" },
    { to: `${base}/speakers/email`, label: "Email speakers", hint: "Speakers" },
    { to: `${base}/content`, label: "Content", hint: "Files and tasks" },
    { to: `${base}/content/requests`, label: "File requests", hint: "Content" },
    { to: `${base}/content/review`, label: "Review deliverables", hint: "Content" },
    { to: `${base}/portals`, label: "Portals", hint: "Speaker portal setup" },
    { to: `${base}/communications`, label: "Communications", hint: "Email log and templates" },
    { to: `${base}/embeds`, label: "Embeds", hint: "Public widgets" },
    { to: `${base}/settings`, label: "Settings", hint: "Event settings" },
    { to: `${base}/settings/taxonomy`, label: "Tracks, formats, rooms", hint: "Settings" },
    { to: `${base}/settings/integrations`, label: "Integrations", hint: "Settings" },
    { to: `${base}/settings/api`, label: "API tokens", hint: "Settings" },
    { to: "/crm", label: "Speaker CRM", hint: "All contacts, every event" },
    { to: "/crm/contacts", label: "Contacts", hint: "Speaker CRM" },
    { to: "/crm/segments", label: "Segments", hint: "Speaker CRM" },
    { to: "/crm/pipeline", label: "Pipeline", hint: "Speaker CRM" },
    { to: "/admin", label: "All events", hint: "Switch event" },
    { to: "/admin/new", label: "Create event", hint: "Switch event" },
    { to: "/docs/api", label: "API documentation", hint: "Reference" },
  ];
}

export interface PaletteHit {
  to: string;
  label: string;
  hint: string;
}

export interface PaletteResults {
  sessions: PaletteHit[];
  speakers: PaletteHit[];
}
