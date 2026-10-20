CREATE TABLE `practice_papers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject` text NOT NULL,
	`unit_name` text NOT NULL,
	`grade_level` text DEFAULT '' NOT NULL,
	`questions` text NOT NULL,
	`answers` text DEFAULT '[]' NOT NULL,
	`grading` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`graded_at` text
);
