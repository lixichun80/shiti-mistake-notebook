CREATE TABLE `mistakes` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`user_id` text NOT NULL,
	`subject` text NOT NULL,
	`question` text NOT NULL,
	`incorrect_answer` text NOT NULL,
	`correct_answer` text NOT NULL,
	`reasoning` text NOT NULL,
	`knowledge_point` text NOT NULL,
	`page_number` integer NOT NULL,
	`source_name` text NOT NULL,
	`similar_questions` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject` text NOT NULL,
	`file_keys` text NOT NULL,
	`file_names` text NOT NULL,
	`created_at` text NOT NULL
);
