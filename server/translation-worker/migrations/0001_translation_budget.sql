-- Aggregate counters only. Never store source text, translation or credentials.
CREATE TABLE IF NOT EXISTS translation_budget (
  month TEXT PRIMARY KEY,
  characters INTEGER NOT NULL DEFAULT 0 CHECK (characters >= 0),
  minute INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0)
);
