CREATE TABLE `eval_plan_reviewers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eval_plan_reviewers_uq` ON `eval_plan_reviewers` (`plan_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `eval_criteria` ADD `kind` text DEFAULT 'numeric' NOT NULL;--> statement-breakpoint
ALTER TABLE `eval_criteria` ADD `options_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `eval_scores` ADD `value_text` text;