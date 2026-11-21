CREATE TABLE `game_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`choices` text NOT NULL,
	`allow_ai_generated_assets` integer DEFAULT true NOT NULL,
	`ticket_repo` text,
	`ticket_number` integer,
	`status` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`scope` text,
	`scope_hash` text,
	`game_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "game_drafts_status" CHECK("game_drafts"."status" IN ('open', 'agreed', 'abandoned', 'promoted')),
	CONSTRAINT "game_drafts_revision" CHECK("game_drafts"."revision" >= 0),
	CONSTRAINT "game_drafts_scope_payload" CHECK(("game_drafts"."scope" IS NULL AND "game_drafts"."scope_hash" IS NULL) OR ("game_drafts"."scope" IS NOT NULL AND "game_drafts"."scope_hash" IS NOT NULL AND "game_drafts"."status" IN ('agreed', 'promoted'))),
	CONSTRAINT "game_drafts_ticket_pair" CHECK("game_drafts"."ticket_number" IS NULL OR "game_drafts"."ticket_repo" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `game_drafts_expiry` ON `game_drafts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `game_drafts_owner` ON `game_drafts` (`creator_id`,`status`);
