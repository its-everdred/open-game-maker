CREATE TABLE `command_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`job_id` text,
	`ticket` text,
	`title` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`question` text NOT NULL,
	`option_id` text NOT NULL,
	`likes` text NOT NULL,
	`dislikes` text NOT NULL,
	`notes` text,
	`at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "command_reviews_likes_array" CHECK(json_type("command_reviews"."likes") = 'array'),
	CONSTRAINT "command_reviews_dislikes_array" CHECK(json_type("command_reviews"."dislikes") = 'array')
);
--> statement-breakpoint
CREATE INDEX `command_reviews_game_at` ON `command_reviews` (`game_id`,`at`);--> statement-breakpoint
CREATE INDEX `command_reviews_checkpoint` ON `command_reviews` (`checkpoint_id`);