CREATE TABLE `room_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`invitation_id` text,
	`joined_at` text NOT NULL,
	`revoked_at` text,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `room_members_user_id_index` ON `room_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`build_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`max_players` integer NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rooms_max_players_check" CHECK("rooms"."max_players" BETWEEN 1 AND 8)
);
--> statement-breakpoint
CREATE INDEX `rooms_game_branch_open_index` ON `rooms` (`game_id`,`branch_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `rooms_owner_id_index` ON `rooms` (`owner_id`);