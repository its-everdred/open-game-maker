CREATE TABLE `game_reviews` (
	`game_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`number` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `decision_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_reviews_game_number_unique` ON `game_reviews` (`game_id`,`number`);