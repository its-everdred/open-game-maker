ALTER TABLE `review_rounds` ADD `effort` text;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `audio_verified` integer DEFAULT false NOT NULL;