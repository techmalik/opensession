// Writes drizzle/0013_headshot_png.sql: replaces the seeded SVG monogram headshots
// with the PNG equivalents the hardened upload/serve path accepts. Run once; the
// output is committed. A fresh install has no matching rows and the migration is a
// no-op there, because seed.sql already ships PNGs.
import { writeFileSync } from "node:fs";
import { headshotPng } from "./headshot-png.mjs";

const HEADSHOT_BG = ["#0f172a", "#334155", "#0d9166", "#0284c7", "#475569", "#7c3aed", "#b45309", "#be123c"];
const initials = { 1: "PR", 2: "MO", 3: "ES", 4: "TL", 6: "RT", 7: "MH", 8: "DP" };
const NOW = Math.floor(new Date("2026-08-09T20:00:00Z").getTime() / 1000);

const lines = [
  "-- Data migration, written by hand. The seeded monogram headshots were SVG, and SVG",
  "-- is a scriptable document: the security pass narrowed uploads and every route that",
  "-- serves them to PNG, JPEG, WebP, and GIF, so these had to become raster or stop",
  "-- rendering. Same pictures, same keys apart from the extension. A fresh install has",
  "-- none of these rows (seed.sql ships PNGs already) and this does nothing there.",
  "",
];

const stmts = [];
for (const [id, mono] of Object.entries(initials)) {
  const png = headshotPng(mono, HEADSHOT_BG[(Number(id) - 1) % HEADSHOT_BG.length]);
  const oldKey = `headshot-seed/${id}.svg`;
  const newKey = `headshot-seed/${id}.png`;
  stmts.push(
    `INSERT OR REPLACE INTO blobs (key,data,content_type,size,created_at) SELECT '${newKey}',X'${png.toString(
      "hex"
    )}','image/png',${png.length},${NOW} WHERE EXISTS (SELECT 1 FROM blobs WHERE key='${oldKey}')`
  );
  stmts.push(`UPDATE contacts SET headshot_blob_key='${newKey}' WHERE headshot_blob_key='${oldKey}'`);
  stmts.push(`UPDATE file_uploads SET blob_key='${newKey}', content_type='image/png' WHERE blob_key='${oldKey}'`);
  stmts.push(`DELETE FROM blobs WHERE key='${oldKey}'`);
}

// Elena's headshot is also a file_uploads row, with its own key and filename.
const elena = headshotPng("ES", HEADSHOT_BG[2]);
stmts.push(
  `INSERT OR REPLACE INTO blobs (key,data,content_type,size,created_at) SELECT 'headshot-3/elena.png',X'${elena.toString(
    "hex"
  )}','image/png',${elena.length},${NOW} WHERE EXISTS (SELECT 1 FROM blobs WHERE key='headshot-3/elena.svg')`
);
stmts.push(`UPDATE contacts SET headshot_blob_key='headshot-3/elena.png' WHERE headshot_blob_key='headshot-3/elena.svg'`);
stmts.push(
  `UPDATE file_uploads SET blob_key='headshot-3/elena.png', filename='elena-sorescu.png', content_type='image/png' WHERE blob_key='headshot-3/elena.svg'`
);
stmts.push(`DELETE FROM blobs WHERE key='headshot-3/elena.svg'`);

writeFileSync("drizzle/0013_headshot_png.sql", lines.join("\n") + stmts.join(";\n--> statement-breakpoint\n") + ";\n");
console.log(`Wrote drizzle/0013_headshot_png.sql (${stmts.length} statements)`);
