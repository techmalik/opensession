CREATE TABLE `session_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`title` text NOT NULL,
	`abstract` text,
	`editor_user_id` integer,
	`editor_name` text DEFAULT 'Unknown' NOT NULL,
	`note` text DEFAULT 'Edited' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_revisions_session_idx` ON `session_revisions` (`session_id`);