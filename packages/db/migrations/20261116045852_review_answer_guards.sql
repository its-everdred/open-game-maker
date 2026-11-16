CREATE TABLE `review_answer_guards` (
	`source` text NOT NULL,
	`ticket` text NOT NULL,
	`episode` text,
	`observed_review` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`source`, `ticket`)
);
