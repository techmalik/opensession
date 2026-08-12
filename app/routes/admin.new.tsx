import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin.new";
import { requireOrganizer } from "../lib/session.server";
import { createEvent } from "../lib/events.server";
import { TIMEZONES } from "../lib/timezones";
import { fromDateInputValue } from "../lib/format";
import {
  Breadcrumbs,
  Field,
  ErrorSummary,
  PageHeader,
  TopBar,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Create event" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  return { user };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const form = await request.formData();

  const name = String(form.get("name") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const timezone = String(form.get("timezone") ?? "America/Los_Angeles");
  const startsAt = fromDateInputValue(form.get("startsAt"));
  const endsAt = fromDateInputValue(form.get("endsAt"));

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter an event name.";
  if (startsAt && endsAt && endsAt < startsAt) errors.endsAt = "The end date is before the start date.";
  if (Object.keys(errors).length > 0) {
    return { errors, values: { name, location, description, timezone } };
  }

  const eventId = await createEvent({
    name,
    location: location || null,
    description: description || null,
    timezone,
    startsAt,
    endsAt,
    createdBy: user.id,
  });

  return redirect(`/admin/${eventId}`);
}

export default function NewEvent({ loaderData, actionData }: Route.ComponentProps) {
  const errors = actionData?.errors ?? {};
  const values = actionData?.values;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar section="Create event" userName={loaderData.user.name} homeTo="/admin" />

      <main className="p-6">
        <div className="max-w-[640px]">
          <Breadcrumbs items={[{ to: "/admin", label: "Events" }, { label: "Create event" }]} />
          <PageHeader title="Create event" description="You can change any of this later in Settings." />

          <Form method="post" className="space-y-4">
            <ErrorSummary errors={errors} />

            <Field label="Event name" name="name" required error={errors.name}>
              <input id="name" name="name" type="text" defaultValue={values?.name ?? ""} className={inputClass} required autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date" name="startsAt">
                <input id="startsAt" name="startsAt" type="date" className={inputClass} />
              </Field>
              <Field label="End date" name="endsAt" error={errors.endsAt}>
                <input id="endsAt" name="endsAt" type="date" className={inputClass} />
              </Field>
            </div>

            <Field label="Location" name="location" help="Venue and city, or the word Online.">
              <input id="location" name="location" type="text" defaultValue={values?.location ?? ""} className={inputClass} />
            </Field>

            <Field label="Timezone" name="timezone" help="Used for schedule times and CFP deadlines.">
              <select id="timezone" name="timezone" defaultValue={values?.timezone ?? "America/Los_Angeles"} className={selectClass}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Description" name="description">
              <textarea id="description" name="description" rows={4} defaultValue={values?.description ?? ""} className={textareaClass} />
            </Field>

            <div className="flex items-center gap-2 pt-1">
              <button type="submit" className={buttonPrimary} disabled={submitting}>
                {submitting ? "Creating event" : "Create event"}
              </button>
              <Link to="/admin" className={buttonSecondary}>
                Cancel
              </Link>
            </div>
          </Form>
        </div>
      </main>
    </div>
  );
}
