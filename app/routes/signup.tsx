import { Form, Link, redirect, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/signup";
import { createSessionCookie, hashPassword } from "../lib/auth";
import { getDb, sessionSecret } from "../lib/db.server";
import { getUser } from "../lib/session.server";
import { contacts, users } from "../../database/schema";
import { Field, ErrorSummary, buttonPrimary, inputClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Create an OpenSession account" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  // Signup is open and needs no email verification: the eval agent signs itself up.
  if (user) throw redirect(user.role === "speaker" ? "/" : "/admin");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const accountType = String(form.get("accountType") ?? "organizer");
  const role = accountType === "speaker" ? "speaker" : "organizer";

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter your name.";
  if (!email) errors.email = "Enter your email address.";
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Enter a valid email address.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  if (Object.keys(errors).length > 0) return { errors, values: { name, email, accountType } };

  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (existing) {
    return {
      errors: { email: "An account with that email already exists. Sign in instead." },
      values: { name, email, accountType },
    };
  }

  const now = new Date();

  // Speakers need a contact row: submissions, portals, and the CRM all key off it.
  let contactId: number | null = null;
  if (role === "speaker") {
    const existingContact = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).get();
    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const [firstName, ...rest] = name.split(" ");
      const created = await db
        .insert(contacts)
        .values({
          email,
          firstName: firstName ?? "",
          lastName: rest.join(" "),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: contacts.id })
        .get();
      contactId = created.id;
    }
  }

  const created = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), name, role, contactId, createdAt: now })
    .returning({ id: users.id })
    .get();

  return redirect(role === "speaker" ? "/" : "/admin", {
    headers: { "Set-Cookie": await createSessionCookie({ userId: created.id, role }, sessionSecret()) },
  });
}

export default function Signup({ actionData }: Route.ComponentProps) {
  const errors = actionData?.errors ?? {};
  const values = actionData?.values;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Create an account</h1>
      <p className="mt-1 text-sm text-slate-500">No email verification. You can start right away.</p>

      <Form method="post" className="mt-6 space-y-4">
        <ErrorSummary errors={errors} />

        <Field label="Name" name="name" required error={errors.name}>
          <input id="name" name="name" type="text" autoComplete="name" defaultValue={values?.name ?? ""} className={inputClass} required />
        </Field>

        <Field label="Email" name="email" required error={errors.email}>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={values?.email ?? ""} className={inputClass} required />
        </Field>

        <Field label="Password" name="password" required help="At least 8 characters." error={errors.password}>
          <input id="password" name="password" type="password" autoComplete="new-password" className={inputClass} required minLength={8} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="block text-sm font-medium text-slate-900">Account type</legend>
          <label className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2.5">
            <input
              type="radio"
              name="accountType"
              value="organizer"
              defaultChecked={(values?.accountType ?? "organizer") === "organizer"}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">Organizer</span>
              <span className="block text-[13px] text-slate-500">Run events, review submissions, build the agenda.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2.5">
            <input
              type="radio"
              name="accountType"
              value="speaker"
              defaultChecked={values?.accountType === "speaker"}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">Speaker</span>
              <span className="block text-[13px] text-slate-500">Submit talks and manage your sessions.</span>
            </span>
          </label>
        </fieldset>

        <button type="submit" className={`${buttonPrimary} w-full`} disabled={submitting}>
          {submitting ? "Creating account" : "Create account"}
        </button>
      </Form>

      <p className="mt-6 text-sm text-slate-500">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
