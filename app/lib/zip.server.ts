// ZIP building for the deliverables export. fflate is the one dependency added for
// this: writing a store-only ZIP by hand is possible but the CRC32 and central
// directory are exactly the kind of code you do not want to debug near a deadline.

import { zipSync } from "fflate";

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

function safeSegment(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "untitled"
  );
}

export function zipPath(folder: string | null, filename: string): string {
  const file = safeSegment(filename);
  return folder ? `${safeSegment(folder)}/${file}` : file;
}

/** Deflate-compressed archive. Duplicate paths get a numeric suffix. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const entry of entries) {
    let path = entry.path;
    if (used.has(path)) {
      const dot = path.lastIndexOf(".");
      const stem = dot > 0 ? path.slice(0, dot) : path;
      const ext = dot > 0 ? path.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem}-${n}${ext}`)) n++;
      path = `${stem}-${n}${ext}`;
    }
    used.add(path);
    files[path] = entry.data;
  }
  return zipSync(files, { level: 6 });
}

export function zipResponse(filename: string, data: Uint8Array): Response {
  return new Response(data as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
