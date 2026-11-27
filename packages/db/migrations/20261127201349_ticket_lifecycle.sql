PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_aiur_events` (
	`daemon_slug` text NOT NULL,
	`epoch` text DEFAULT '' NOT NULL,
	`seq` integer NOT NULL,
	`topic` text NOT NULL,
	`ticket` text,
	`job_id` text,
	`payload` text NOT NULL,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`daemon_slug`, `epoch`, `seq`)
);
--> statement-breakpoint
INSERT INTO `__new_aiur_events`("daemon_slug", "epoch", "seq", "topic", "ticket", "job_id", "payload", "observed_at") SELECT "daemon_slug", 'legacy', "seq", "topic", "ticket", "job_id", "payload", "observed_at" FROM `aiur_events`;--> statement-breakpoint
DROP TABLE `aiur_events`;--> statement-breakpoint
ALTER TABLE `__new_aiur_events` RENAME TO `aiur_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `aiur_events_job_seq` ON `aiur_events` (`job_id`,`seq`);--> statement-breakpoint
ALTER TABLE `job_tickets` ADD `cancel_requested_at` text;--> statement-breakpoint
ALTER TABLE `job_tickets` ADD `terminal_state` text;--> statement-breakpoint
ALTER TABLE `job_tickets` ADD `lifecycle_seq` integer;
