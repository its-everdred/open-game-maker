PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`git_sha` text NOT NULL,
	`job_id` text,
	`sdk_version` text NOT NULL,
	`save_schema_version` integer NOT NULL,
	`migrates_from_schema` integer,
	`achievement_catalog_hash` text NOT NULL,
	`status` text NOT NULL,
	`prototype_review_state` text DEFAULT 'none' NOT NULL,
	`artifact` text NOT NULL,
	`artifact_path` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "builds_save_schema_version_check" CHECK("__new_builds"."save_schema_version" >= 0),
	CONSTRAINT "builds_migrates_from_schema_check" CHECK("__new_builds"."migrates_from_schema" IS NULL OR "__new_builds"."migrates_from_schema" >= 0),
	CONSTRAINT "builds_status_check" CHECK("__new_builds"."status" IN ('building', 'tested', 'failed')),
	CONSTRAINT "builds_prototype_review_state_check" CHECK("__new_builds"."prototype_review_state" IN ('pending', 'posted', 'none')),
	CONSTRAINT "builds_artifact_check" CHECK("__new_builds"."artifact" IN ('present', 'gc'))
);
--> statement-breakpoint
INSERT INTO `__new_builds`("id", "game_id", "branch_id", "git_sha", "job_id", "sdk_version", "save_schema_version", "migrates_from_schema", "achievement_catalog_hash", "status", "prototype_review_state", "artifact", "artifact_path", "created_at") SELECT "id", "game_id", "branch_id", "git_sha", "job_id", "sdk_version", "save_schema_version", "migrates_from_schema", "achievement_catalog_hash", "status", 'none', "artifact", "artifact_path", "created_at" FROM `builds`;--> statement-breakpoint
DROP TABLE `builds`;--> statement-breakpoint
ALTER TABLE `__new_builds` RENAME TO `builds`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `builds_game_branch_index` ON `builds` (`game_id`,`branch_id`);
