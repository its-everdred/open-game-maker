CREATE TABLE `energy_caps` (
	`id` text PRIMARY KEY NOT NULL,
	`limit` real,
	`updated_at` text NOT NULL,
	CONSTRAINT "energy_caps_value" CHECK(coalesce("energy_caps"."limit", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE `energy_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_id` text NOT NULL,
	`at` text NOT NULL,
	`left` real,
	`low` real,
	`high` real,
	`basis` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `energy_samples_at` ON `energy_samples` (`at`);