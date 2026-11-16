CREATE TABLE `review_answer_guards` (
	`source` text NOT NULL,
	`ticket` text NOT NULL,
	PRIMARY KEY(`source`, `ticket`)
);
