CREATE TABLE `game_access` (
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`access` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `email`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email`) REFERENCES `allowed_users`(`email`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "game_access_access_check" CHECK("game_access"."access" IN ('hide', 'play', 'edit'))
);
--> statement-breakpoint
CREATE INDEX `game_access_email_index` ON `game_access` (`email`);--> statement-breakpoint
CREATE TABLE `game_access_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`previous_access` text,
	`access` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
