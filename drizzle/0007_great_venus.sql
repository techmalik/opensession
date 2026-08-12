CREATE TABLE `task_reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer NOT NULL,
	`last_reminded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_reminders_uq` ON `task_reminders` (`contact_id`,`kind`,`ref_id`);