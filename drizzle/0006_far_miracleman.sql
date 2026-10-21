CREATE TABLE `knowledge_units` (
	`user_id` text NOT NULL,
	`subject` text NOT NULL,
	`knowledge_point` text NOT NULL,
	`unit_name` text DEFAULT '' NOT NULL,
	`guide` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `subject`, `knowledge_point`)
);
