CREATE TABLE `saved_embeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`widget_type` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`flag` text NOT NULL,
	`set_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_flags_uq` ON `user_flags` (`user_id`,`flag`);--> statement-breakpoint
ALTER TABLE `ai_reviews` ADD `override_score` integer;--> statement-breakpoint
ALTER TABLE `ai_reviews` ADD `override_reason` text;--> statement-breakpoint
ALTER TABLE `ai_reviews` ADD `override_by` text;--> statement-breakpoint
ALTER TABLE `ai_reviews` ADD `override_at` integer;