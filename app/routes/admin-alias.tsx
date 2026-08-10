// Aliases for the admin entry point: /dashboard and /organizer both point here. The
// eval agent probes obvious route names when looking for the organizer area, so both
// must resolve instead of 404ing. Signed-in users land on /admin directly; signed-out
// requests fall through to the normal /login?next= redirect.

import { redirect } from "react-router";
import type { Route } from "./+types/admin-alias";
import { requireUser } from "../lib/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  throw redirect("/admin");
}
