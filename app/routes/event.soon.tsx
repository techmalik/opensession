import { useLocation } from "react-router";
import type { Route } from "./+types/event.soon";
import { requireOrganizer } from "../lib/session.server";
import { Card, PageHeader } from "../components/ui";

// Placeholder for the nav items Phases 2 to 5 fill in. It exists so the sidebar never
// dead-ends into a 404, and it is deliberately plain: no fake data, no teaser copy.

const SECTIONS: Record<string, { title: string; note: string }> = {
  submissions: { title: "Submissions", note: "Abstracts arrive here once a call for papers is published." },
  forms: { title: "Forms", note: "Build the call for papers, then publish it to collect submissions." },
  evaluations: { title: "Evaluations", note: "Evaluation plans, evaluator assignments, and scores." },
  agenda: { title: "Agenda", note: "Schedule accepted sessions into rooms and time slots." },
  speakers: { title: "Speakers", note: "Speakers for this event, drawn from accepted sessions." },
  contacts: { title: "Contacts", note: "Everyone connected to this event." },
  portals: { title: "Portals", note: "The speaker portal, its tasks, and its file requests." },
  communications: { title: "Communications", note: "Every email this event has sent, and the templates behind them." },
  embeds: { title: "Embeds", note: "Public session, speaker, and agenda widgets, plus the calendar feed." },
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  return null;
}

export default function ComingSoon() {
  const location = useLocation();
  const key = location.pathname.split("/").filter(Boolean).pop() ?? "";
  const section = SECTIONS[key] ?? { title: "Not built yet", note: "This area is still being built." };

  return (
    <>
      <PageHeader title={section.title} />
      <Card className="p-4">
        <p className="text-sm text-slate-500">{section.note}</p>
        <p className="mt-2 text-[13px] text-slate-500">This area is not built yet.</p>
      </Card>
    </>
  );
}
