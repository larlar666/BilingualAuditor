CREATE TABLE deepseek_trial_budget (
  trial_id TEXT PRIMARY KEY CHECK(trial_id = 'deepseek-official-translation-trial-v1'),
  reserved_micro_cny INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micro_cny BETWEEN 0 AND 1000000),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4),
  sample_mask INTEGER NOT NULL DEFAULT 0 CHECK(sample_mask BETWEEN 0 AND 15),
  request_ids TEXT NOT NULL DEFAULT '|' CHECK(length(request_ids) BETWEEN 1 AND 149),
  CHECK(reserved_micro_cny = attempts * 250000)
);
INSERT INTO deepseek_trial_budget(trial_id) VALUES ('deepseek-official-translation-trial-v1');
