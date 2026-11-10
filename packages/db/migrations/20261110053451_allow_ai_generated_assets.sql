ALTER TABLE `games` ADD `allow_ai_generated_assets` integer DEFAULT true NOT NULL
  CONSTRAINT `games_allow_ai_generated_assets_check` CHECK (`allow_ai_generated_assets` IN (0, 1));
