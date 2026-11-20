ALTER TABLE `review_rounds` ADD `works` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `limitations` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `decision_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `source_tickets` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `clip_status` text;