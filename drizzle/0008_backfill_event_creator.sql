-- Data migration, written by hand: drizzle-kit generates schema, not backfills, and
-- creator scoping is only as good as the owner recorded on events that already exist.
-- Idempotent, and it never takes an event away from an owner it already has.

-- The fixture organizer created DevFlow Conf 2027; the eval agent signs in as them.
UPDATE events
SET created_by = (SELECT id FROM users WHERE email = 'sbek-organizer@example.com')
WHERE created_by IS NULL
  AND slug = 'devflow-conf-2027'
  AND EXISTS (SELECT 1 FROM users WHERE email = 'sbek-organizer@example.com');
--> statement-breakpoint

-- The seeded demo event belongs to the demo organizer.
UPDATE events
SET created_by = (SELECT id FROM users WHERE email = 'organizer@demo.meridian.dev')
WHERE created_by IS NULL
  AND slug = 'meridian-dev-summit-2027'
  AND EXISTS (SELECT 1 FROM users WHERE email = 'organizer@demo.meridian.dev');
--> statement-breakpoint

-- Anything else with no recorded creator falls to the admin, who can see every event
-- anyway. Without this an ownerless event would be reachable by nobody.
UPDATE events
SET created_by = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
WHERE created_by IS NULL
  AND EXISTS (SELECT 1 FROM users WHERE role = 'admin');
