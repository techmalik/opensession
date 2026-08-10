import { Form, Link } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/event.taxonomy";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { formats, levels, rooms, tags, tracks } from "../../database/schema";
import { Card, PageHeader, buttonPrimary, buttonGhost, buttonSecondary, inputClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Tracks and formats" }];
}

type Kind = "tracks" | "formats" | "levels" | "rooms" | "tags";

const KINDS: Kind[] = ["tracks", "formats", "levels", "rooms", "tags"];

function isKind(value: string): value is Kind {
  return (KINDS as string[]).includes(value);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  return {
    tracks: await db
      .select({ id: tracks.id, name: tracks.name, sort: tracks.sort })
      .from(tracks)
      .where(eq(tracks.eventId, eventId))
      .orderBy(asc(tracks.sort), asc(tracks.id))
      .all(),
    formats: await db
      .select({ id: formats.id, name: formats.name, durationMin: formats.durationMin, sort: formats.sort })
      .from(formats)
      .where(eq(formats.eventId, eventId))
      .orderBy(asc(formats.sort), asc(formats.id))
      .all(),
    levels: await db
      .select({ id: levels.id, name: levels.name, sort: levels.sort })
      .from(levels)
      .where(eq(levels.eventId, eventId))
      .orderBy(asc(levels.sort), asc(levels.id))
      .all(),
    rooms: await db
      .select({ id: rooms.id, name: rooms.name, capacity: rooms.capacity, sort: rooms.sort })
      .from(rooms)
      .where(eq(rooms.eventId, eventId))
      .orderBy(asc(rooms.sort), asc(rooms.id))
      .all(),
    tags: await db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(eq(tags.eventId, eventId))
      .orderBy(asc(tags.id))
      .all(),
  };
}

/** Next sort value for a kind, so new rows land at the bottom. */
async function nextSort(kind: Exclude<Kind, "tags">, eventId: number): Promise<number> {
  const db = getDb();
  const rows =
    kind === "tracks"
      ? await db.select({ sort: tracks.sort }).from(tracks).where(eq(tracks.eventId, eventId)).all()
      : kind === "formats"
        ? await db.select({ sort: formats.sort }).from(formats).where(eq(formats.eventId, eventId)).all()
        : kind === "levels"
          ? await db.select({ sort: levels.sort }).from(levels).where(eq(levels.eventId, eventId)).all()
          : await db.select({ sort: rooms.sort }).from(rooms).where(eq(rooms.eventId, eventId)).all();
  return rows.reduce((max, row) => Math.max(max, row.sort), -1) + 1;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const form = await request.formData();

  const intent = String(form.get("intent") ?? "");
  const kindRaw = String(form.get("kind") ?? "");
  if (!isKind(kindRaw)) return { error: "Unknown list." };
  const kind = kindRaw;

  const db = getDb();
  const id = Number(form.get("id") ?? 0);
  const name = String(form.get("name") ?? "").trim();
  const numeric = String(form.get("numeric") ?? "").trim();
  const numericValue = numeric ? Number(numeric) : null;

  if (intent === "create") {
    if (!name) return { error: "Enter a name." };
    const sort = kind === "tags" ? 0 : await nextSort(kind, eventId);
    if (kind === "tracks") await db.insert(tracks).values({ eventId, name, sort });
    else if (kind === "formats") await db.insert(formats).values({ eventId, name, durationMin: numericValue, sort });
    else if (kind === "levels") await db.insert(levels).values({ eventId, name, sort });
    else if (kind === "rooms") await db.insert(rooms).values({ eventId, name, capacity: numericValue, sort });
    else await db.insert(tags).values({ eventId, name });
    return { error: null };
  }

  if (intent === "rename") {
    if (!name) return { error: "Enter a name." };
    if (kind === "tracks") await db.update(tracks).set({ name }).where(and(eq(tracks.id, id), eq(tracks.eventId, eventId)));
    else if (kind === "formats")
      await db.update(formats).set({ name, durationMin: numericValue }).where(and(eq(formats.id, id), eq(formats.eventId, eventId)));
    else if (kind === "levels") await db.update(levels).set({ name }).where(and(eq(levels.id, id), eq(levels.eventId, eventId)));
    else if (kind === "rooms")
      await db.update(rooms).set({ name, capacity: numericValue }).where(and(eq(rooms.id, id), eq(rooms.eventId, eventId)));
    else await db.update(tags).set({ name }).where(and(eq(tags.id, id), eq(tags.eventId, eventId)));
    return { error: null };
  }

  if (intent === "delete") {
    if (kind === "tracks") await db.delete(tracks).where(and(eq(tracks.id, id), eq(tracks.eventId, eventId)));
    else if (kind === "formats") await db.delete(formats).where(and(eq(formats.id, id), eq(formats.eventId, eventId)));
    else if (kind === "levels") await db.delete(levels).where(and(eq(levels.id, id), eq(levels.eventId, eventId)));
    else if (kind === "rooms") await db.delete(rooms).where(and(eq(rooms.id, id), eq(rooms.eventId, eventId)));
    else await db.delete(tags).where(and(eq(tags.id, id), eq(tags.eventId, eventId)));
    return { error: null };
  }

  if (intent === "move" && kind !== "tags") {
    const direction = String(form.get("direction") ?? "up") === "down" ? 1 : -1;
    const list =
      kind === "tracks"
        ? await db.select({ id: tracks.id, sort: tracks.sort }).from(tracks).where(eq(tracks.eventId, eventId)).orderBy(asc(tracks.sort), asc(tracks.id)).all()
        : kind === "formats"
          ? await db.select({ id: formats.id, sort: formats.sort }).from(formats).where(eq(formats.eventId, eventId)).orderBy(asc(formats.sort), asc(formats.id)).all()
          : kind === "levels"
            ? await db.select({ id: levels.id, sort: levels.sort }).from(levels).where(eq(levels.eventId, eventId)).orderBy(asc(levels.sort), asc(levels.id)).all()
            : await db.select({ id: rooms.id, sort: rooms.sort }).from(rooms).where(eq(rooms.eventId, eventId)).orderBy(asc(rooms.sort), asc(rooms.id)).all();

    const index = list.findIndex((row) => row.id === id);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) return { error: null };

    // Positions can collide after manual edits, so write index-based values rather
    // than swapping the stored numbers.
    const reordered = [...list];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(swapWith, 0, moved);

    for (const [position, row] of reordered.entries()) {
      if (kind === "tracks") await db.update(tracks).set({ sort: position }).where(eq(tracks.id, row.id));
      else if (kind === "formats") await db.update(formats).set({ sort: position }).where(eq(formats.id, row.id));
      else if (kind === "levels") await db.update(levels).set({ sort: position }).where(eq(levels.id, row.id));
      else await db.update(rooms).set({ sort: position }).where(eq(rooms.id, row.id));
    }
    return { error: null };
  }

  return { error: null };
}

interface ListItem {
  id: number;
  name: string;
  numeric?: number | null;
}

function TaxonomySection({
  kind,
  title,
  description,
  items,
  numericLabel,
  reorderable = true,
}: {
  kind: Kind;
  title: string;
  description: string;
  items: ListItem[];
  numericLabel?: string;
  reorderable?: boolean;
}) {
  return (
    <Card>
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">Nothing here yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
              <Form method="post" className="flex flex-1 items-center gap-2">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={item.id} />
                <input name="name" defaultValue={item.name} aria-label={`${title} name`} className={`${inputClass} flex-1`} />
                {numericLabel ? (
                  <input
                    name="numeric"
                    type="number"
                    min={0}
                    defaultValue={item.numeric ?? ""}
                    aria-label={numericLabel}
                    placeholder={numericLabel}
                    className={`${inputClass} w-28`}
                  />
                ) : null}
                <button type="submit" name="intent" value="rename" className={buttonSecondary}>
                  Save
                </button>
              </Form>

              {reorderable ? (
                <>
                  <Form method="post">
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      type="submit"
                      name="intent"
                      value="move"
                      className={buttonGhost}
                      aria-label={`Move ${item.name} up`}
                      disabled={index === 0}
                    >
                      Up
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      name="intent"
                      value="move"
                      className={buttonGhost}
                      aria-label={`Move ${item.name} down`}
                      disabled={index === items.length - 1}
                    >
                      Down
                    </button>
                  </Form>
                </>
              ) : null}

              <Form method="post" onSubmit={(e) => !confirm(`Delete "${item.name}"?`) && e.preventDefault()}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={item.id} />
                <button type="submit" name="intent" value="delete" className={buttonGhost} aria-label={`Delete ${item.name}`}>
                  Delete
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}

      <Form method="post" className="flex items-center gap-2 border-t border-slate-200 px-3 py-2.5">
        <input type="hidden" name="kind" value={kind} />
        <input name="name" placeholder={`Add ${title.toLowerCase().replace(/s$/, "")}`} aria-label={`New ${title}`} className={`${inputClass} flex-1`} />
        {numericLabel ? (
          <input name="numeric" type="number" min={0} placeholder={numericLabel} aria-label={numericLabel} className={`${inputClass} w-28`} />
        ) : null}
        <button type="submit" name="intent" value="create" className={buttonPrimary}>
          Add
        </button>
      </Form>
    </Card>
  );
}

export default function Taxonomy({ loaderData, actionData, params }: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        title="Tracks and formats"
        description="The lists submitters and organizers pick from. Order here is the order they appear everywhere else."
        actions={
          <Link to={`/admin/${params.eventId}/settings`} className={buttonSecondary}>
            Back to Settings
          </Link>
        }
      />

      {actionData?.error ? (
        <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {actionData.error}
        </div>
      ) : null}

      <div className="grid max-w-[900px] gap-4">
        <TaxonomySection kind="tracks" title="Tracks" description="Themes a session belongs to." items={loaderData.tracks} />
        <TaxonomySection
          kind="formats"
          title="Formats"
          description="Session shapes and their length in minutes."
          items={loaderData.formats.map((f) => ({ id: f.id, name: f.name, numeric: f.durationMin }))}
          numericLabel="Minutes"
        />
        <TaxonomySection kind="levels" title="Levels" description="Audience experience level." items={loaderData.levels} />
        <TaxonomySection
          kind="rooms"
          title="Rooms"
          description="Physical or virtual rooms the agenda schedules into."
          items={loaderData.rooms.map((r) => ({ id: r.id, name: r.name, numeric: r.capacity }))}
          numericLabel="Capacity"
        />
        <TaxonomySection
          kind="tags"
          title="Tags"
          description="Free-form labels for filtering. Not shown to submitters."
          items={loaderData.tags}
          reorderable={false}
        />
      </div>
    </>
  );
}
