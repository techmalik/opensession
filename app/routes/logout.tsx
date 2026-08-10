import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { CLEAR_SESSION_COOKIE } from "../lib/auth";

// POST only: a GET here would let any image tag sign the user out.
export async function action(_: Route.ActionArgs) {
  return redirect("/", { headers: { "Set-Cookie": CLEAR_SESSION_COOKIE } });
}

export async function loader(_: Route.LoaderArgs) {
  return redirect("/");
}
