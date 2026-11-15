CREATE TABLE phone_budget (
  trial_id TEXT PRIMARY KEY CHECK(trial_id='deepseek-phone-hotspot-demo-v1'),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 20),
  reserved_micro_cny INTEGER NOT NULL CHECK(reserved_micro_cny=attempts*150000 AND reserved_micro_cny<=3000000),
  request_ids TEXT NOT NULL
);
INSERT INTO phone_budget VALUES ('deepseek-phone-hotspot-demo-v1',0,0,'|');
