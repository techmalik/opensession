CREATE TABLE `file_request_assignees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`contact_id` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_request_assignees_uq` ON `file_request_assignees` (`request_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `task_assignees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`contact_id` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_assignees_uq` ON `task_assignees` (`task_id`,`contact_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `travel` text;--> statement-breakpoint
ALTER TABLE `event_contacts` ADD `status` text DEFAULT 'invited' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `agenda_published_at` integer;--> statement-breakpoint
ALTER TABLE `file_requests` ADD `sample_filename` text;--> statement-breakpoint
ALTER TABLE `file_uploads` ADD `reviewed_by_user_id` integer;--> statement-breakpoint
ALTER TABLE `file_uploads` ADD `reviewed_at` integer;