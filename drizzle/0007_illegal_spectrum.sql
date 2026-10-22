CREATE TABLE `essay_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prompt_text` text DEFAULT '' NOT NULL,
	`original_text` text NOT NULL,
	`grade_level` text DEFAULT '' NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `essay_reports_user_created_idx` ON `essay_reports` (`user_id`,`created_at`);