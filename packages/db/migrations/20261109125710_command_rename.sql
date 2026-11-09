ALTER TABLE `checkpoints` RENAME TO `commands`;--> statement-breakpoint
ALTER TABLE `design_decisions` RENAME COLUMN "checkpoint_id" TO "command_id";--> statement-breakpoint
ALTER TABLE `command_reviews` RENAME COLUMN "checkpoint_id" TO "command_id";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_commands` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`daemon_slug` text NOT NULL,
	`version` integer NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`recommend` text,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`answered_at` text,
	CONSTRAINT "commands_status" CHECK("__new_commands"."status" IN ('open', 'answered', 'moot'))
);
--> statement-breakpoint
INSERT INTO `__new_commands`("decision_id", "job_id", "daemon_slug", "version", "question", "options", "recommend", "status", "opened_at", "answered_at") SELECT "decision_id", "job_id", "daemon_slug", "version", "question", "options", "recommend", "status", "opened_at", "answered_at" FROM `commands`;--> statement-breakpoint
DROP TABLE `commands`;--> statement-breakpoint
ALTER TABLE `__new_commands` RENAME TO `commands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `commands_job` ON `commands` (`job_id`);--> statement-breakpoint
CREATE TABLE `__new_build_chat_messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`job_id` text NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`media_hash` text,
	`poster_hash` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`command_json` text,
	`aiur_ticket` text,
	`aiur_event_id` integer,
	`aiur_topic` text,
	`mirror_state` text,
	CONSTRAINT "build_chat_messages_actor" CHECK("__new_build_chat_messages"."actor" IN ('creator', 'agent', 'system')),
	CONSTRAINT "build_chat_messages_kind" CHECK("__new_build_chat_messages"."kind" IN ('text', 'image', 'clip', 'command', 'progress'))
);
--> statement-breakpoint
INSERT INTO `__new_build_chat_messages`("seq", "id", "job_id", "at", "actor", "kind", "text", "media_hash", "poster_hash", "width", "height", "duration_ms", "command_json", "aiur_ticket", "aiur_event_id", "aiur_topic", "mirror_state") SELECT "seq", "id", "job_id", "at", "actor", CASE "kind" WHEN 'checkpoint' THEN 'command' ELSE "kind" END, "text", "media_hash", "poster_hash", "width", "height", "duration_ms", CASE WHEN json_type("checkpoint_json", '$.checkpoint_id') IS NULL THEN "checkpoint_json" ELSE json_set(json_remove("checkpoint_json", '$.checkpoint_id'), '$.command_id', json_extract("checkpoint_json", '$.checkpoint_id')) END, "aiur_ticket", "aiur_event_id", "aiur_topic", "mirror_state" FROM `build_chat_messages`;--> statement-breakpoint
DROP TABLE `build_chat_messages`;--> statement-breakpoint
ALTER TABLE `__new_build_chat_messages` RENAME TO `build_chat_messages`;--> statement-breakpoint
CREATE UNIQUE INDEX `build_chat_messages_id_unique` ON `build_chat_messages` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `build_chat_messages_job_event_unique` ON `build_chat_messages` (`job_id`,`aiur_event_id`);--> statement-breakpoint
CREATE INDEX `build_chat_messages_job_seq` ON `build_chat_messages` (`job_id`,`seq`);--> statement-breakpoint
DROP INDEX `design_decisions_game_checkpoint`;--> statement-breakpoint
CREATE INDEX `design_decisions_game_command` ON `design_decisions` (`game_id`,`command_id`);--> statement-breakpoint
DROP INDEX `command_reviews_checkpoint`;--> statement-breakpoint
CREATE INDEX `command_reviews_command` ON `command_reviews` (`command_id`);