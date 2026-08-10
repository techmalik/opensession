import { Form, Link, redirect, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/login";
import { createSessionCookie, verifyPassword } from "../lib/auth";
import { getDb, sessionSecret } from "../lib/db.server";
import { getUser } from "../lib/session.server";
import { users } from "../../database/schema";
import { Field, ErrorSummary, buttonPrimary, inputClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Sign in to OpenSession" }];
}

/** Where to land after signing in, by role. Speakers and evaluators go to the
 *  landing page until Phase 2 builds the reviewer dashboard and Phase 3 the portal;
 *  sending them to /admin would greet them with a 403. */
function landingFor(role: string): string {
  return role === "admin" || role === "organizer" ? "/admin" : "/";
}

function safeNext(raw: string | null): string | null {
  // Only same-origin paths. An absolute URL would be an open redirect, and so would
  // "//host" or "/\\host": browsers normalize backslashes to forward slashes.
  if (!raw || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.includes("\\")) return null;
  return raw;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  if (user) throw redirect(next ?? landingFor(user.role));
  return { next };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "") || null);

  const errors: Record<string, string> = {};
  if (!email) errors.email = "Enter your email address.";
  if (!password) errors.password = "Enter your password.";
  if (Object.keys(errors).length > 0) return { errors, email };

  const db = getDb();
  const user = await db
    .select({ id: users.id, role: users.role, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .get();

  // Same message either way: do not reveal which emails have accounts.
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return { errors: { password: "That email and password do not match an account." }, email };
  }

  return redirect(next ?? landingFor(user.role), {
    headers: { "Set-Cookie": await createSessionCookie({ userId: user.id, role: user.role }, sessionSecret()) },
  });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const errors = actionData?.errors ?? {};
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Organizers, evaluators, and speakers use the same sign in.</p>

      <Form method="post" className="mt-6 space-y-4">
        <ErrorSummary errors={errors} />
        <input type="hidden" name="next" value={loaderData.next ?? ""} />

        <Field label="Email" name="email" required error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={actionData?.email ?? ""}
            className={inputClass}
            required
          />
        </Field>

        <Field label="Password" name="password" required error={errors.password}>
          <input id="password" name="password" type="password" autoComplete="current-password" className={inputClass} required />
        </Field>

        <button type="submit" className={`${buttonPrimary} h-11 w-full`} disabled={submitting}>
          {submitting ? "Signing in" : "Sign in"}
        </button>
      </Form>

      <p className="mt-6 text-sm text-slate-500">
        No account?{" "}
        <Link to="/signup" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
