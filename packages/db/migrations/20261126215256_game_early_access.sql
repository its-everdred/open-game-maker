CREATE TABLE `game_early_access` (
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`game_id`, `user_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
