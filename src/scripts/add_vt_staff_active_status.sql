BEGIN;

ALTER TABLE vt_staff_details
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_vt_staff_details_vtp_active
  ON vt_staff_details (vtp_id, is_active);

COMMIT;
