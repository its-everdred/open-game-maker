CREATE TABLE `publish_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`git_sha` text NOT NULL,
	`build_id` text,
	`surface` text NOT NULL,
	`sizes_json` text NOT NULL,
	`checks_json` text NOT NULL,
	`result` text NOT NULL,
	`publish_result` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publish_checks_game_index` ON `publish_checks` (`game_id`,`created_at`);