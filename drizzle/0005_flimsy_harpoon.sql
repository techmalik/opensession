CREATE TABLE `crm_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`field_key` text NOT NULL,
	`label` text NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`options_json` text DEFAULT '[]' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_fields_key_uq` ON `crm_fields` (`field_key`);--> statement-breakpoint
CREATE TABLE `crm_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`body` text NOT NULL,
	`author_user_id` integer,
	`author_name` text DEFAULT 'Unknown' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crm_notes_contact_idx` ON `crm_notes` (`contact_id`);--> statement-breakpoint
CREATE TABLE `crm_prospect_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prospect_id` integer NOT NULL,
	`kind` text NOT NULL,
	`from_stage` text,
	`to_stage` text,
	`body` text,
	`author_user_id` integer,
	`author_name` text DEFAULT 'Unknown' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crm_prospect_events_idx` ON `crm_prospect_events` (`prospect_id`);--> statement-breakpoint
CREATE TABLE `crm_prospects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`event_id` integer,
	`stage` text DEFAULT 'identified' NOT NULL,
	`score` integer,
	`rationale` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_prospects_contact_uq` ON `crm_prospects` (`contact_id`);--> statement-breakpoint
CREATE INDEX `crm_prospects_stage_idx` ON `crm_prospects` (`stage`);--> statement-breakpoint
CREATE TABLE `crm_segment_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment_id` integer NOT NULL,
	`contact_id` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_segment_members_uq` ON `crm_segment_members` (`segment_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `crm_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'dynamic' NOT NULL,
	`filters_json` text DEFAULT '{}' NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL
);
