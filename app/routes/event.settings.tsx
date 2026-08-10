import { Form, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.settings";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { uniqueSlug } from "../lib/events.server";
import { TIMEZONES } from "../lib/timezones";
import { fromDateInputValue, toDateInputValue } from "../lib/format";
import { events } from "../../database/schema";
import {
  Card,
  Field,
  ErrorSummary,
  PageHeader,
  SubNav,
  buttonPrimary,
  inputClass,
  selectClass,
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Settings" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const db = getDb();
  const event = await db.select().from(events).where(eq(events.id, Number(params.eventId))).get();
  if (!event) throw new Response("Event not found", { status: 404 });
  return { event };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const form = await request.formData();

  const name = String(form.get("name") ?? "").trim();
  const tagline = String(form.get("tagline") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const timezone = String(form.get("timezone") ?? "America/Los_Angeles");
  const status = String(form.get("status") ?? "active");
  const startsAt = fromDateInputValue(form.get("startsAt"));
  const endsAt = fromDateInputValue(form.get("endsAt"));

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter an event name.";
  if (startsAt && endsAt && endsAt < startsAt) errors.endsAt = "The end date is before the start date.";
  if (Object.keys(errors).length > 0) return { errors, saved: false };

  const db = getDb();
  const current = await db.select({ name: events.name, slug: events.slug }).from(events).where(eq(events.id, eventId)).get();
  if (!current) throw new Response("Event not found", { status: 404 });

  // Renaming regenerates the slug, which public URLs depend on. Keep the old slug
  // when the name has not changed so existing links stay valid.
  const slug = current.name === name ? current.slug : await uniqueSlug(name, eventId);

  await db
    .update(events)
    .set({
      name,
      slug,
      tagline: tagline || null,
      location: location || null,
      description: description || null,
      timezone,
      status: status === "draft" || status === "archived" ? status : "active",
      startsAt,
      endsAt,
    })
    .where(eq(events.id, eventId));

  return { errors: {}, saved: true };
}

export default function EventSettings({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event } = loaderData;
  const errors = actionData?.errors ?? {};
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <>
      <PageHeader
        title="Settings"
        description="Event details, and the tracks, formats, rooms, levels, and tags this event uses."
      />
      <SubNav
        items={[
          { to: `/admin/${params.eventId}/settings`, label: "Event" },
          { to: `/admin/${params.eventId}/settings/taxonomy`, label: "Tracks and formats" },
          { to: `/admin/${params.eventId}/settings/integrations`, label: "Integrations" },
        ]}
        current={`/admin/${params.eventId}/settings`}
      />

      <div className="max-w-[640px]">
        {actionData?.saved ? (
          <div role="status" className="mb-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            Settings saved.
          </div>
        ) : null}

        <Card className="p-4">
          <Form method="post" className="space-y-4">
            <ErrorSummary errors={errors} />

            <Field label="Event name" name="name" required error={errors.name}>
              <input id="name" name="name" type="text" defaultValue={event.name} className={inputClass} required />
            </Field>

            <Field label="Tagline" name="tagline" help="One line, shown on public pages.">
              <input id="tagline" name="tagline" type="text" defaultValue={event.tagline ?? ""} className={inputClass} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date" name="startsAt">
                <input id="startsAt" name="startsAt" type="date" defaultValue={toDateInputValue(event.startsAt)} className={inputClass} />
              </Field>
              <Field label="End date" name="endsAt" error={errors.endsAt}>
                <input id="endsAt" name="endsAt" type="date" defaultValue={toDateInputValue(event.endsAt)} className={inputClass} />
              </Field>
            </div>

            <Field label="Location" name="location">
              <input id="location" name="location" type="text" defaultValue={event.location ?? ""} className={inputClass} />
            </Field>

            <Field label="Timezone" name="timezone">
              <select id="timezone" name="timezone" defaultValue={event.timezone} className={selectClass}>
                {(TIMEZONES.includes(event.timezone) ? TIMEZONES : [event.timezone, ...TIMEZONES]).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Description" name="description">
              <textarea id="description" name="description" rows={4} defaultValue={event.description ?? ""} className={textareaClass} />
            </Field>

            <Field label="Event status" name="status" help="Archived events stay readable but drop out of the default list.">
              <select id="status" name="status" defaultValue={event.status} className={selectClass}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </Field>

            <Field label="Public slug" name="slug" help="Used in public CFP, portal, and embed URLs. Follows the event name.">
              <input id="slug" name="slug" type="text" value={event.slug} readOnly className={`${inputClass} bg-slate-50 font-mono text-slate-500`} />
            </Field>

            <div className="pt-1">
              <button type="submit" className={buttonPrimary} disabled={submitting}>
                {submitting ? "Saving" : "Save changes"}
              </button>
            </div>
          </Form>
        </Card>
      </div>
    </>
  );
}
