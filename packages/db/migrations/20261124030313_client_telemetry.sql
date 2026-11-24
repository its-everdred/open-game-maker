CREATE TABLE `client_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_at` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`origin` text NOT NULL,
	`app_version` text NOT NULL,
	`device` text NOT NULL,
	`game_id` text,
	`build_id` text,
	`signature` text,
	`detail_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_events_received_idx` ON `client_events` (`received_at`);--> statement-breakpoint
CREATE INDEX `client_events_game_build_idx` ON `client_events` (`game_id`,`build_id`,`kind`);--> statement-breakpoint
CREATE TABLE `crash_groups` (
	`game_id` text NOT NULL,
	`build_id` text NOT NULL,
	`signature` text NOT NULL,
	`crash` text NOT NULL,
	`message` text NOT NULL,
	`count` integer NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`first_event_id` integer NOT NULL,
	`last_event_id` integer NOT NULL,
	PRIMARY KEY(`game_id`, `build_id`, `signature`)
);
--> statement-breakpoint
CREATE INDEX `crash_groups_first_event_idx` ON `crash_groups` (`first_event_id`);