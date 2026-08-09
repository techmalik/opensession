CREATE TABLE `ai_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`persona` text NOT NULL,
	`score` integer NOT NULL,
	`review_text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `airtable_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`record_id` integer NOT NULL,
	`airtable_id` text NOT NULL,
	`last_pushed_hash` text,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_links_uq` ON `airtable_links` (`table_name`,`record_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`key` text PRIMARY KEY NOT NULL,
	`data` blob NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`title` text,
	`company` text,
	`bio` text,
	`headshot_blob_key` text,
	`phone` text,
	`twitter` text,
	`linkedin` text,
	`website` text,
	`dietary` text,
	`tshirt` text,
	`notes` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`rating` integer,
	`custom_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_email_uq` ON `contacts` (`email`);--> statement-breakpoint
CREATE TABLE `email_sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer,
	`template_key` text,
	`to_email` text NOT NULL,
	`to_contact_id` integer,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`ics_attached` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `email_sends_contact_idx` ON `email_sends` (`to_contact_id`);--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eval_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_id` integer NOT NULL,
	`evaluator_user_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eval_assign_uq` ON `eval_assignments` (`plan_id`,`evaluator_user_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `eval_assign_user_idx` ON `eval_assignments` (`evaluator_user_id`);--> statement-breakpoint
CREATE TABLE `eval_criteria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_id` integer NOT NULL,
	`label` text NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eval_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`blind` integer DEFAULT true NOT NULL,
	`anonymized` integer DEFAULT false NOT NULL,
	`scale_type` text DEFAULT 'stars5' NOT NULL,
	`max_evals_per_submission` integer,
	`due_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eval_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`criterion_id` integer,
	`score` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `eval_scores_assignment_idx` ON `eval_scores` (`assignment_id`);--> statement-breakpoint
CREATE TABLE `event_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`kind` text DEFAULT 'speaker' NOT NULL,
	`digest_opt_in` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_contacts_uq` ON `event_contacts` (`event_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `event_contacts_event_idx` ON `event_contacts` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`tagline` text,
	`description` text,
	`location` text,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_unique` ON `events` (`slug`);--> statement-breakpoint
CREATE TABLE `file_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`upload_id` integer NOT NULL,
	`author_user_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`title` text NOT NULL,
	`instructions` text,
	`due_at` integer,
	`sample_blob_key` text,
	`applies_to` text DEFAULT 'accepted_speakers' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer,
	`event_id` integer NOT NULL,
	`contact_id` integer,
	`session_id` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`blob_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`approval` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_uploads_request_idx` ON `file_uploads` (`request_id`);--> statement-breakpoint
CREATE INDEX `file_uploads_session_idx` ON `file_uploads` (`session_id`);--> statement-breakpoint
CREATE TABLE `form_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` integer NOT NULL,
	`section` text DEFAULT 'session' NOT NULL,
	`field_key` text NOT NULL,
	`label` text NOT NULL,
	`help_text` text,
	`type` text NOT NULL,
	`options_json` text DEFAULT '[]' NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`conditional_json` text
);
--> statement-breakpoint
CREATE INDEX `form_fields_form_idx` ON `form_fields` (`form_id`);--> statement-breakpoint
CREATE TABLE `formats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`duration_min` integer,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`type` text DEFAULT 'abstract' NOT NULL,
	`welcome_html` text,
	`thank_you_html` text,
	`opens_at` integer,
	`closes_at` integer,
	`submission_limit` integer,
	`max_speakers` integer DEFAULT 4 NOT NULL,
	`allow_drafts` integer DEFAULT true NOT NULL,
	`allow_edit_after_submit` integer DEFAULT true NOT NULL,
	`confirmation_subject` text,
	`confirmation_body` text,
	`reminder_days_json` text DEFAULT '[5,1]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`run_after` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portal_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_at` integer,
	`applies_to` text DEFAULT 'accepted_speakers' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`capacity` integer,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`role` text DEFAULT 'speaker' NOT NULL,
	`invite_status` text DEFAULT 'confirmed' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sp_session_idx` ON `session_participants` (`session_id`);--> statement-breakpoint
CREATE INDEX `sp_contact_idx` ON `session_participants` (`contact_id`);--> statement-breakpoint
CREATE TABLE `session_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`tag_id` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_tags_uq` ON `session_tags` (`session_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`friendly_id` text NOT NULL,
	`title` text NOT NULL,
	`abstract` text,
	`is_abstract` integer DEFAULT true NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`status_id` integer,
	`form_id` integer,
	`submitted_by` integer,
	`track_id` integer,
	`format_id` integer,
	`level_id` integer,
	`room_id` integer,
	`starts_at` integer,
	`ends_at` integer,
	`video_url` text,
	`answers_json` text DEFAULT '{}' NOT NULL,
	`decision_email_sent_at` integer,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_event_idx` ON `sessions` (`event_id`);--> statement-breakpoint
CREATE INDEX `sessions_status_idx` ON `sessions` (`status_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_friendly_uq` ON `sessions` (`friendly_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`color` text DEFAULT '#94a3b8' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#94a3b8' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_completion_uq` ON `task_completions` (`task_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#45cc93' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'speaker' NOT NULL,
	`contact_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);