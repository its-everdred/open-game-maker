CREATE TABLE `review_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`track` text NOT NULL,
	`phase` text NOT NULL,
	`category` text NOT NULL,
	`round` integer NOT NULL,
	`ticket` text NOT NULL,
	`pr_number` integer,
	`sha` text NOT NULL,
	`media` text NOT NULL,
	`question` text,
	`posted_at` text NOT NULL,
	`verdict` text,
	`notes` text,
	`verdict_at` text,
	`verdict_source` text,
	`consumed_by_run` text,
	`consumed_at` text,
	`reminded_at` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_rounds_positive_round" CHECK("review_rounds"."round" > 0),
	CONSTRAINT "review_rounds_media_array" CHECK(json_type("review_rounds"."media") = 'array'),
	CONSTRAINT "review_rounds_verdict" CHECK("review_rounds"."verdict" IS NULL OR "review_rounds"."verdict" IN ('approved', 'needs_work', 'kill')),
	CONSTRAINT "review_rounds_verdict_source" CHECK("review_rounds"."verdict_source" IS NULL OR "review_rounds"."verdict_source" IN ('preview', 'command', 'comment')),
	CONSTRAINT "review_rounds_answer_consistent" CHECK(("review_rounds"."verdict" IS NULL AND "review_rounds"."verdict_at" IS NULL AND "review_rounds"."verdict_source" IS NULL) OR ("review_rounds"."verdict" IS NOT NULL AND "review_rounds"."verdict_at" IS NOT NULL AND "review_rounds"."verdict_source" IS NOT NULL)),
	CONSTRAINT "review_rounds_consumed_consistent" CHECK(("review_rounds"."consumed_by_run" IS NULL AND "review_rounds"."consumed_at" IS NULL) OR ("review_rounds"."consumed_by_run" IS NOT NULL AND "review_rounds"."consumed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_rounds_phase_round` ON `review_rounds` (`game_id`,`track`,`phase`,`round`);--> statement-breakpoint
CREATE INDEX `review_rounds_ticket` ON `review_rounds` (`game_id`,`ticket`);--> statement-breakpoint
CREATE TABLE `review_dispatch_intents` (
	`round_id` text PRIMARY KEY NOT NULL,
	`ticket` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`run_id` text,
	FOREIGN KEY (`round_id`) REFERENCES `review_rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
