CREATE TABLE `review_phase_owners` (
	`game_id` text NOT NULL,
	`track` text NOT NULL,
	`phase` text NOT NULL,
	`ticket` text NOT NULL,
	`source_round_id` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_round_id`) REFERENCES `review_rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_phase_owners_phase` ON `review_phase_owners` (`game_id`,`track`,`phase`);