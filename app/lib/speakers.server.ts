// One query behind the organizer speaker roster, its CSV export, and the bulk email
// recipient picker, so the rows you filtered are exactly the rows you act on.

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { deliverableMatrix, taskMatrix } from "./tasks.server";
import type { SpeakerStatus } from "./labels";
import { contacts, eventContacts, sessionParticipants, sessions, statuses } from "../../database/schema";

export type { SpeakerStatus } from "./labels";

export interface SpeakerFilters {
  q?: string;
  status?: string;
  /** accepted | no_headshot | no_bio | tasks_incomplete | files_incomplete */
  flag?: string;
}

export interface SpeakerRow {
  contactId: number;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotBlobKey: string | null;
  status: SpeakerStatus;
  sessionTitles: string[];
  acceptedCount: number;
  tasksDone: number;
  tasksTotal: number;
  filesDone: number;
  filesTotal: number;
}

export async function querySpeakers(eventId: number, filters: SpeakerFilters): Promise<SpeakerRow[]> {
  const db = getDb();

  const roster = await db
    .select({
      contactId: eventContacts.contactId,
      status: eventContacts.status,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      title: contacts.title,
      company: contacts.company,
      bio: contacts.bio,
      headshotBlobKey: contacts.headshotBlobKey,
    })
    .from(eventContacts)
    .innerJoin(contacts, eq(eventContacts.contactId, contacts.id))
    .where(and(eq(eventContacts.eventId, eventId), eq(eventContacts.kind, "speaker")))
    .orderBy(asc(contacts.firstName), asc(contacts.lastName))
    .all();

  const contactIds = roster.map((r) => r.contactId);
  const sessionRows =
    contactIds.length > 0
      ? await db
          .select({
            contactId: sessionParticipants.contactId,
            title: sessions.title,
            statusKey: statuses.key,
          })
          .from(sessionParticipants)
          .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
          .leftJoin(statuses, eq(sessions.statusId, statuses.id))
          .where(and(eq(sessions.eventId, eventId), inArray(sessionParticipants.contactId, contactIds)))
          .all()
      : [];

  const tasks = await taskMatrix(eventId);
  const deliverables = await deliverableMatrix(eventId);

  const rows: SpeakerRow[] = roster.map((row) => {
    const mySessions = sessionRows.filter((s) => s.contactId === row.contactId);
    const myTasks = tasks.cells.filter((c) => c.contactId === row.contactId);
    const myFiles = deliverables.cells.filter((c) => c.contactId === row.contactId);
    return {
      contactId: row.contactId,
      firstName: row.firstName,
      lastName: row.lastName,
      name: `${row.firstName} ${row.lastName}`.trim() || row.email,
      email: row.email,
      title: row.title,
      company: row.company,
      bio: row.bio,
      headshotBlobKey: row.headshotBlobKey,
      status: row.status,
      sessionTitles: mySessions.map((s) => s.title),
      acceptedCount: mySessions.filter((s) => s.statusKey === "accepted").length,
      tasksDone: myTasks.filter((c) => c.status === "done").length,
      tasksTotal: myTasks.length,
      filesDone: myFiles.filter((c) => c.status === "done").length,
      filesTotal: myFiles.length,
    };
  });

  let result = rows;
  const q = (filters.q ?? "").trim().toLowerCase();
  if (q) {
    result = result.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        (row.company ?? "").toLowerCase().includes(q) ||
        (row.title ?? "").toLowerCase().includes(q)
    );
  }
  if (filters.status) result = result.filter((row) => row.status === filters.status);
  if (filters.flag === "accepted") result = result.filter((row) => row.acceptedCount > 0);
  if (filters.flag === "no_headshot") result = result.filter((row) => !row.headshotBlobKey);
  if (filters.flag === "no_bio") result = result.filter((row) => !(row.bio ?? "").trim());
  if (filters.flag === "tasks_incomplete") result = result.filter((row) => row.tasksDone < row.tasksTotal);
  if (filters.flag === "files_incomplete") result = result.filter((row) => row.filesDone < row.filesTotal);

  return result;
}

// ---------- CSV import ----------

/** Header aliases, lowercased and stripped of anything but letters. */
const HEADER_MAP: Record<string, keyof ImportedSpeaker> = {
  firstname: "firstName",
  first: "firstName",
  givenname: "firstName",
  lastname: "lastName",
  last: "lastName",
  surname: "lastName",
  familyname: "lastName",
  name: "fullName",
  fullname: "fullName",
  speaker: "fullName",
  email: "email",
  emailaddress: "email",
  title: "title",
  jobtitle: "title",
  role: "title",
  company: "company",
  organization: "company",
  organisation: "company",
  employer: "company",
  bio: "bio",
  biography: "bio",
  twitter: "twitter",
  x: "twitter",
  linkedin: "linkedin",
  website: "website",
  url: "website",
  phone: "phone",
  dietary: "dietary",
  tshirt: "tshirt",
  shirtsize: "tshirt",
  travel: "travel",
  notes: "notes",
};

export interface ImportedSpeaker {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  title: string;
  company: string;
  bio: string;
  twitter: string;
  linkedin: string;
  website: string;
  phone: string;
  dietary: string;
  tshirt: string;
  travel: string;
  notes: string;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

export interface ImportPreviewRow {
  row: ImportedSpeaker;
  action: "create" | "update" | "skip";
  reason?: string;
}

export interface ImportPreview {
  headers: string[];
  mapped: (keyof ImportedSpeaker | null)[];
  unmapped: string[];
  rows: ImportPreviewRow[];
}

function emptySpeaker(): ImportedSpeaker {
  return {
    firstName: "",
    lastName: "",
    fullName: "",
    email: "",
    title: "",
    company: "",
    bio: "",
    twitter: "",
    linkedin: "",
    website: "",
    phone: "",
    dietary: "",
    tshirt: "",
    travel: "",
    notes: "",
  };
}

/** Auto-maps headers to contact fields and marks each row create/update/skip against
 *  the contacts already in the database. Nothing is written here. */
export async function previewImport(eventId: number, table: string[][]): Promise<ImportPreview> {
  const db = getDb();
  const [headerRow, ...dataRows] = table;
  const headers = (headerRow ?? []).map((h) => h.trim());
  const mapped = headers.map((header) => HEADER_MAP[normalizeHeader(header)] ?? null);
  const unmapped = headers.filter((_, index) => mapped[index] === null);

  const parsed: ImportedSpeaker[] = dataRows.map((cells) => {
    const row = emptySpeaker();
    headers.forEach((_, index) => {
      const key = mapped[index];
      if (!key) return;
      row[key] = (cells[index] ?? "").trim();
    });
    if (!row.firstName && !row.lastName && row.fullName) {
      const [first, ...rest] = row.fullName.split(/\s+/);
      row.firstName = first ?? "";
      row.lastName = rest.join(" ");
    }
    row.email = row.email.toLowerCase();
    return row;
  });

  const emails = [...new Set(parsed.map((r) => r.email).filter(Boolean))];
  const existing =
    emails.length > 0
      ? await db.select({ id: contacts.id, email: contacts.email }).from(contacts).where(inArray(contacts.email, emails)).all()
      : [];
  const existingEmails = new Set(existing.map((row) => row.email));

  const seen = new Set<string>();
  const rows: ImportPreviewRow[] = parsed.map((row) => {
    if (!row.email) return { row, action: "skip", reason: "No email address" };
    if (seen.has(row.email)) return { row, action: "skip", reason: "Duplicate row in this file" };
    seen.add(row.email);
    return existingEmails.has(row.email)
      ? { row, action: "update", reason: "Matched an existing contact by email" }
      : { row, action: "create" };
  });

  return { headers, mapped, unmapped, rows };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

/** Applies a preview. Existing contacts keep any value the CSV leaves blank.
 *  createdBy is stamped on new rows so an import into the org database alone still
 *  belongs to somebody: without an event link it is the only thing making the record
 *  visible to the person who imported it. */
export async function applyImport(eventId: number, preview: ImportPreview, createdBy: number | null = null): Promise<ImportResult> {
  const db = getDb();
  const now = new Date();
  const result: ImportResult = { created: 0, updated: 0, skipped: 0 };

  for (const entry of preview.rows) {
    if (entry.action === "skip") {
      result.skipped += 1;
      continue;
    }
    const row = entry.row;
    const existing = await db.select().from(contacts).where(eq(contacts.email, row.email)).get();

    const values = {
      firstName: row.firstName || existing?.firstName || "",
      lastName: row.lastName || existing?.lastName || "",
      title: row.title || existing?.title || null,
      company: row.company || existing?.company || null,
      bio: row.bio || existing?.bio || null,
      twitter: row.twitter || existing?.twitter || null,
      linkedin: row.linkedin || existing?.linkedin || null,
      website: row.website || existing?.website || null,
      phone: row.phone || existing?.phone || null,
      dietary: row.dietary || existing?.dietary || null,
      tshirt: row.tshirt || existing?.tshirt || null,
      travel: row.travel || existing?.travel || null,
      notes: row.notes || existing?.notes || null,
      updatedAt: now,
    };

    let contactId: number;
    if (existing) {
      await db.update(contacts).set(values).where(eq(contacts.id, existing.id));
      contactId = existing.id;
      result.updated += 1;
    } else {
      const created = await db
        .insert(contacts)
        .values({ email: row.email, ...values, createdBy, createdAt: now })
        .returning({ id: contacts.id })
        .get();
      contactId = created.id;
      result.created += 1;
    }

    // eventId 0 means "org database only": there is no roster to add them to.
    if (eventId > 0) {
      await db
        .insert(eventContacts)
        .values({ eventId, contactId, kind: "speaker" })
        .onConflictDoNothing();
    }
  }

  return result;
}
