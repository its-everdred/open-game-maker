CREATE TABLE `game_play_sessions` (
	`game_id` text NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_play_sessions_created_idx` ON `game_play_sessions` (`created_at`);--> statement-breakpoint
CREATE INDEX `game_play_sessions_user_idx` ON `game_play_sessions` (`game_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `game_play_totals` (
	`game_id` text PRIMARY KEY NOT NULL,
	`plays` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `game_play_totals` (`game_id`, `plays`)
SELECT `game_id`, CAST(SUM(`value`) AS INTEGER)
FROM `creator_analytics_daily`
WHERE `metric` = 'plays' AND `release_id` = '' AND `scope` = ''
GROUP BY `game_id`;
