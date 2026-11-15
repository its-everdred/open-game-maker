CREATE TABLE `game_plays` (
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_played_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `user_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
