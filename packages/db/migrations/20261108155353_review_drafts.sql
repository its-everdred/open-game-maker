CREATE TABLE `review_drafts` (
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`draft_key` text NOT NULL,
	`deck` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `user_id`, `draft_key`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_drafts_deck_object" CHECK(json_type("review_drafts"."deck") = 'object')
);
