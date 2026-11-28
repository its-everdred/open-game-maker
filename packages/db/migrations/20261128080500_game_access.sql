CREATE TABLE `game_access` (
	`game_id` text NOT NULL,
	`email` text NOT NULL,
	`access` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `email`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
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
--> statement-breakpoint
-- Invited addresses have no family yet; retain the Hide shown before their first sign-in.
INSERT INTO `game_access` (`game_id`, `email`, `access`, `updated_by`, `updated_at`)
SELECT g.`id`, a.`email`, 'hide', 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `games` AS g CROSS JOIN `allowed_users` AS a
WHERE NOT EXISTS (SELECT 1 FROM `user` AS u WHERE lower(u.`email`) = a.`email`);
