// The speaker's own profile. Everything an organizer sees on the roster is edited
// here, including the headshot, which goes through app/lib/storage.ts like any other
// upload so the organizer can download it later.

import { Form } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/portal.profile";
import { bindings, getDb } from "../lib/db.server";
import { requireSpeaker, myEvents, myProfile } from "../lib/portal.server";
import { newBlobKey, putFile } from "../lib/storage";
import { contacts, fileUploads } from "../../database/schema";
import {
  AppBar,
  Card,
  ErrorNotice,
  Field,
  Notice,
  PortalNav,
  buttonPrimary,
  inputClass,
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "My profile | Your portal" }];
}

const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024;
const HEADSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function loader({ request }: Route.LoaderArgs) {
  const { user, contactId } = await requireSpeaker(request);
  const profile = await myProfile(contactId);
  if (!profile) throw new Response("Profile not found", { status: 404 });

  const db = getDb();
  const headshotUpload = profile.headshotBlobKey
    ? await db
        .select({ id: fileUploads.id })
        .from(fileUploads)
        .where(eq(fileUploads.blobKey, profile.headshotBlobKey))
        .get()
    : null;

  return { user, profile, headshotUploadId: headshotUpload?.id ?? null };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, contactId } = await requireSpeaker(request);
  const db = getDb();
  const form = await request.formData();

  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  if (!firstName) return { error: "Enter your first name.", notice: null };

  const headshot = form.get("headshot");
  let headshotBlobKey: string | undefined;
  if (headshot instanceof File && headshot.size > 0) {
    if (headshot.size > MAX_HEADSHOT_BYTES) {
      return { error: "That image is larger than 5 MB. Upload a smaller file.", notice: null };
    }
    if (headshot.type && !HEADSHOT_TYPES.includes(headshot.type)) {
      return { error: "Headshots must be PNG, JPEG, or WebP.", notice: null };
    }
    const key = newBlobKey(`headshot-${contactId}`, headshot.name || "headshot.png");
    await putFile(bindings, key, await headshot.arrayBuffer(), headshot.type || "image/png");
    headshotBlobKey = key;

    // Recorded as an upload too, so the organizer sees it in the files list with
    // its filename, size, and timestamp rather than as an opaque blob key.
    const [primaryEvent] = await myEvents(contactId);
    await db.insert(fileUploads).values({
      requestId: null,
      eventId: primaryEvent?.id ?? 0,
      contactId,
      sessionId: null,
      version: 1,
      blobKey: key,
      filename: headshot.name || "headshot.png",
      contentType: headshot.type || "image/png",
      size: headshot.size,
      approval: "approved",
      uploadedBy: user.id,
      createdAt: new Date(),
    });
  }

  await db
    .update(contacts)
    .set({
      firstName,
      lastName,
      title: String(form.get("title") ?? "").trim() || null,
      company: String(form.get("company") ?? "").trim() || null,
      bio: String(form.get("bio") ?? "").trim() || null,
      twitter: String(form.get("twitter") ?? "").trim() || null,
      linkedin: String(form.get("linkedin") ?? "").trim() || null,
      website: String(form.get("website") ?? "").trim() || null,
      phone: String(form.get("phone") ?? "").trim() || null,
      dietary: String(form.get("dietary") ?? "").trim() || null,
      tshirt: String(form.get("tshirt") ?? "").trim() || null,
      travel: String(form.get("travel") ?? "").trim() || null,
      ...(headshotBlobKey ? { headshotBlobKey } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contactId));

  return { error: null, notice: "Profile saved." };
}

export default function PortalProfile({ loaderData, actionData }: Route.ComponentProps) {
  const { user, profile, headshotUploadId } = loaderData;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession" userName={user.name} homeTo="/portal" />

      <main className="mx-auto w-full max-w-[720px] px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">My profile</h1>
        <p className="mt-1 text-sm text-slate-500">This is what organizers and the public speakers page show.</p>

        <div className="mt-5">
          <PortalNav current="/portal/profile" />
        </div>

        {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
        {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

        <Card className="p-4">
          <Form method="post" encType="multipart/form-data" className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                {headshotUploadId ? (
                  <img
                    src={`/files/${headshotUploadId}?inline=1`}
                    alt={`Headshot of ${profile.firstName} ${profile.lastName}`.trim()}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Field
                  label="Headshot"
                  name="headshot"
                  help="PNG, JPEG, or WebP, up to 5 MB. A square photo at least 800px wide works best."
                >
                  <input
                    id="headshot"
                    name="headshot"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="block w-full text-sm text-slate-900 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-900"
                  />
                </Field>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" name="firstName" required>
                <input id="firstName" name="firstName" defaultValue={profile.firstName} className={inputClass} required />
              </Field>
              <Field label="Last name" name="lastName">
                <input id="lastName" name="lastName" defaultValue={profile.lastName} className={inputClass} />
              </Field>
            </div>

            <Field label="Email" name="email" help="Contact the organizers to change the address your account uses.">
              <input id="email" name="email" defaultValue={profile.email} className={inputClass} disabled />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job title" name="title">
                <input id="title" name="title" defaultValue={profile.title ?? ""} className={inputClass} />
              </Field>
              <Field label="Company" name="company">
                <input id="company" name="company" defaultValue={profile.company ?? ""} className={inputClass} />
              </Field>
            </div>

            <Field label="Bio" name="bio" help="Two or three sentences, written in the third person.">
              <textarea id="bio" name="bio" rows={6} defaultValue={profile.bio ?? ""} className={textareaClass} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Twitter" name="twitter">
                <input id="twitter" name="twitter" defaultValue={profile.twitter ?? ""} className={inputClass} />
              </Field>
              <Field label="LinkedIn" name="linkedin">
                <input id="linkedin" name="linkedin" defaultValue={profile.linkedin ?? ""} className={inputClass} />
              </Field>
              <Field label="Website" name="website">
                <input id="website" name="website" defaultValue={profile.website ?? ""} className={inputClass} />
              </Field>
              <Field label="Phone" name="phone">
                <input id="phone" name="phone" defaultValue={profile.phone ?? ""} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dietary requirements" name="dietary">
                <input id="dietary" name="dietary" defaultValue={profile.dietary ?? ""} className={inputClass} />
              </Field>
              <Field label="T-shirt size" name="tshirt">
                <input id="tshirt" name="tshirt" defaultValue={profile.tshirt ?? ""} className={inputClass} />
              </Field>
            </div>

            <Field label="Travel and logistics" name="travel" help="Arrival and departure, seating preferences, accessibility needs.">
              <textarea id="travel" name="travel" rows={3} defaultValue={profile.travel ?? ""} className={textareaClass} />
            </Field>

            <button type="submit" className={buttonPrimary}>
              Save profile
            </button>
          </Form>
        </Card>
      </main>
    </div>
  );
}
