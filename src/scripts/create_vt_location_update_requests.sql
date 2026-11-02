BEGIN;

CREATE TABLE IF NOT EXISTS vt_location_update_requests (
  id BIGSERIAL PRIMARY KEY,
  vt_staff_id INTEGER NOT NULL REFERENCES vt_staff_details(id) ON DELETE CASCADE,
  old_district_name VARCHAR(100),
  old_block_name VARCHAR(100),
  old_school_name VARCHAR(200),
  old_udise_code BIGINT,
  requested_district_name VARCHAR(100) NOT NULL,
  requested_block_name VARCHAR(100) NOT NULL,
  requested_school_name VARCHAR(200) NOT NULL,
  requested_udise_code BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewer_remarks VARCHAR(1000),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vt_location_update_pending
  ON vt_location_update_requests (vt_staff_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_vt_location_update_status_requested
  ON vt_location_update_requests (status, requested_at DESC);

COMMIT;
