CREATE TABLE `scene_heads` (
	`game_id` text NOT NULL,
	`scene` text NOT NULL,
	`rev` integer NOT NULL,
	`doc` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `scene`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "scene_heads_rev_check" CHECK("scene_heads"."rev" >= 0)
);
--> statement-breakpoint
CREATE TABLE `scene_revisions` (
	`game_id` text NOT NULL,
	`scene` text NOT NULL,
	`rev` integer NOT NULL,
	`revision` text NOT NULL,
	PRIMARY KEY(`game_id`, `scene`, `rev`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "scene_revisions_rev_check" CHECK("scene_revisions"."rev" >= 1)
);
