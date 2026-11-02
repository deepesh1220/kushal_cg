BEGIN;

ALTER TABLE od_requests
  ADD COLUMN IF NOT EXISTS attachment_path TEXT;

COMMIT;
