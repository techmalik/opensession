// /contacts, /speaker-crm, /directory all mean the same thing to an organizer
// looking for the cross-event database.

import { redirect } from "react-router";
import type { Route } from "./+types/crm-alias";

export async function loader() {
  return redirect("/crm/contacts");
}
