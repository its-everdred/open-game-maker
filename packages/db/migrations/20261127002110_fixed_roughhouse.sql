CREATE TABLE `weekly_job_budgets` (
	`email` text PRIMARY KEY NOT NULL,
	`new_games` integer,
	`edits` integer,
	FOREIGN KEY (`email`) REFERENCES `allowed_users`(`email`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "weekly_job_budgets_values" CHECK(("weekly_job_budgets"."new_games" IS NULL OR "weekly_job_budgets"."new_games" >= 0) AND ("weekly_job_budgets"."edits" IS NULL OR "weekly_job_budgets"."edits" >= 0))
);
