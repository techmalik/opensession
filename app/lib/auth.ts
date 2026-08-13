// PBKDF2-SHA256 password hashing + signed session cookies. WebCrypto only (Workers-safe).

const ITERATIONS = 100_000;

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string, saltB64?: string): Promise<string> {
  const salt = saltB64 ? b64decode(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS },
    key,
    256
  );
  return `pbkdf2$${ITERATIONS}$${b64(salt.buffer as ArrayBuffer)}$${b64(bits)}`;
}

/** A well-formed hash of nothing. Sign-in verifies against this when the email is
 *  unknown, so an account that does not exist costs the same 100,000 iterations as
 *  one that does and the response time stops answering "is this address registered".
 *  Its derived bytes are all zeroes, so no password can match it. */
export const ABSENT_ACCOUNT_HASH =
  `pbkdf2$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

/** Length-independent, branch-free comparison over the whole string. Comparing
 *  derived hashes with === leaks how many leading bytes matched. */
function constantTimeEquals(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const recomputed = await hashPassword(password, parts[2]);
  return constantTimeEquals(recomputed.split("$")[3] ?? "", parts[3]);
}

// ---- Signed session cookie (HMAC-SHA256) ----
export interface SessionData {
  userId: number;
  role: "admin" | "organizer" | "evaluator" | "speaker";
  /** Set only by the landing page's demo buttons, so the UI can say so. */
  demo?: boolean;
  exp: number; // unix seconds
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionCookie(data: Omit<SessionData, "exp">, secret: string, days = 14): Promise<string> {
  const payload: SessionData = { ...data, exp: Math.floor(Date.now() / 1000) + days * 86400 };
  const body = btoa(JSON.stringify(payload));
  const sig = b64(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body)));
  const value = `${body}.${sig}`;
  return `os_session=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${days * 86400}`;
}

export const CLEAR_SESSION_COOKIE = "os_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";

export async function readSession(request: Request, secret: string): Promise<SessionData | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)os_session=([^;]+)/);
  if (!match) return null;
  const [body, sig] = match[1].split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    b64decode(sig) as BufferSource,
    new TextEncoder().encode(body)
  );
  if (!ok) return null;
  try {
    const data = JSON.parse(atob(body)) as SessionData;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
