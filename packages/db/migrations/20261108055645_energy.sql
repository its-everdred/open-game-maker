CREATE TABLE `energy_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`day_micro_usd` integer,
	`week_micro_usd` integer,
	`month_micro_usd` integer,
	`voice_micro_usd` integer,
	`images_micro_usd` integer,
	`updated_at` text NOT NULL,
	CONSTRAINT "energy_limits_singleton" CHECK("energy_limits"."id" = 'instance'),
	CONSTRAINT "energy_limits_values" CHECK(coalesce("energy_limits"."day_micro_usd", 0) >= 0 AND coalesce("energy_limits"."week_micro_usd", 0) >= 0 AND coalesce("energy_limits"."month_micro_usd", 0) >= 0 AND coalesce("energy_limits"."voice_micro_usd", 0) >= 0 AND coalesce("energy_limits"."images_micro_usd", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE `energy_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preference` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "energy_preferences_value" CHECK("energy_preferences"."preference" IN ('save', 'balanced', 'best'))
);
