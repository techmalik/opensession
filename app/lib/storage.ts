// File storage abstraction. Default: D1 blobs table (fine for headshots/slides in a
// demo, D1 free tier is 5GB). If an R2 bucket binding named FILES exists, it is used
// instead. Same interface either way.

import { drizzle } from "drizzle-orm/d1";
import { blobs } from "../../database/schema";
import { eq } from "drizzle-orm";

export interface StorageEnv {
  DB: D1Database;
  FILES?: R2Bucket;
}

export async function putFile(
  env: StorageEnv,
  key: string,
  data: ArrayBuffer,
  contentType: string
): Promise<{ key: string; size: number }> {
  if (env.FILES) {
    await env.FILES.put(key, data, { httpMetadata: { contentType } });
    return { key, size: data.byteLength };
  }
  const db = drizzle(env.DB);
  const bytes = new Uint8Array(data) as unknown as (typeof blobs.$inferInsert)["data"];
  await db
    .insert(blobs)
    .values({ key, data: bytes, contentType, size: data.byteLength, createdAt: new Date() })
    .onConflictDoUpdate({
      target: blobs.key,
      set: { data: bytes, contentType, size: data.byteLength },
    });
  return { key, size: data.byteLength };
}

export async function getFile(
  env: StorageEnv,
  key: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  if (env.FILES) {
    const obj = await env.FILES.get(key);
    if (!obj) return null;
    return { data: await obj.arrayBuffer(), contentType: obj.httpMetadata?.contentType ?? "application/octet-stream" };
  }
  const db = drizzle(env.DB);
  const [row] = await db.select().from(blobs).where(eq(blobs.key, key)).limit(1);
  if (!row) return null;
  const buf = row.data as unknown as ArrayBuffer | Uint8Array;
  const data = buf instanceof Uint8Array ? (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer) : buf;
  return { data, contentType: row.contentType };
}

export function newBlobKey(prefix: string, filename: string): string {
  const safe = filename.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(0, 60);
  return `${prefix}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
}
