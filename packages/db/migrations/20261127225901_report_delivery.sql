ALTER TABLE `platform_issue_queue` ADD `next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `reports` ADD `screenshot` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `request_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `reports_request_key` ON `reports` (`game_id`,`reporter_id`,`request_key`);