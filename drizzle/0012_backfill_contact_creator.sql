-- Data migration, written by hand: drizzle-kit generates schema, not backfills.
-- CRM visibility is "contacts on events you can open, plus contacts you created",
-- so rows that predate contacts.created_by need an owner or they become invisible to
-- everyone but an admin. Idempotent, and it never takes a contact from an owner it
-- already has.

-- Whoever created the first event this person was rostered on. Redundant for
-- visibility (the roster link already grants it) but it makes the record's origin
-- explicit and survives the event being deleted.
UPDATE contacts
SET created_by = (
  SELECT e.created_by
  FROM event_contacts ec
  JOIN events e ON e.id = ec.event_id
  WHERE ec.contact_id = contacts.id AND e.created_by IS NOT NULL
  ORDER BY ec.id
  LIMIT 1
)
WHERE created_by IS NULL;
--> statement-breakpoint

-- Same, through a session credit, for anyone with no roster row.
UPDATE contacts
SET created_by = (
  SELECT e.created_by
  FROM session_participants sp
  JOIN sessions s ON s.id = sp.session_id
  JOIN events e ON e.id = s.event_id
  WHERE sp.contact_id = contacts.id AND e.created_by IS NOT NULL
  ORDER BY sp.id
  LIMIT 1
)
WHERE created_by IS NULL;
--> statement-breakpoint

-- What is left is an org-level record entered straight into the CRM, with nothing
-- linking it to an event. The earliest organizer account is the only evidence of who
-- that was, and on a fresh installation there are no contacts, so this is a no-op.
UPDATE contacts
SET created_by = (SELECT id FROM users WHERE role IN ('admin', 'organizer') ORDER BY id LIMIT 1)
WHERE created_by IS NULL
  AND EXISTS (SELECT 1 FROM users WHERE role IN ('admin', 'organizer'));
