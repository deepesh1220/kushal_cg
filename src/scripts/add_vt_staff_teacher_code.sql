BEGIN;

CREATE SEQUENCE IF NOT EXISTS vt_teacher_code_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE vt_staff_details
  ADD COLUMN IF NOT EXISTS teacher_code VARCHAR(13);

ALTER TABLE vt_staff_details
  ALTER COLUMN teacher_code SET DEFAULT
    ('VT' || LPAD(nextval('vt_teacher_code_seq')::TEXT, 11, '0'));

SELECT setval(
  'vt_teacher_code_seq',
  GREATEST(
    COALESCE((SELECT MAX(SUBSTRING(teacher_code FROM 3)::BIGINT)
              FROM vt_staff_details
              WHERE teacher_code ~ '^VT[0-9]{11}$'), 0),
    1
  ),
  EXISTS (SELECT 1 FROM vt_staff_details WHERE teacher_code ~ '^VT[0-9]{11}$')
);

WITH code_seed AS (
  SELECT COALESCE(MAX(SUBSTRING(teacher_code FROM 3)::BIGINT), 0) AS max_code
  FROM vt_staff_details WHERE teacher_code ~ '^VT[0-9]{11}$'
), missing_codes AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS sequence_number
  FROM vt_staff_details WHERE teacher_code IS NULL OR BTRIM(teacher_code) = ''
)
UPDATE vt_staff_details v
SET teacher_code = 'VT' || LPAD((code_seed.max_code + missing_codes.sequence_number)::TEXT, 11, '0')
FROM code_seed, missing_codes
WHERE v.id = missing_codes.id;

SELECT setval(
  'vt_teacher_code_seq',
  GREATEST(
    COALESCE((SELECT MAX(SUBSTRING(teacher_code FROM 3)::BIGINT)
              FROM vt_staff_details
              WHERE teacher_code ~ '^VT[0-9]{11}$'), 0),
    1
  ),
  EXISTS (SELECT 1 FROM vt_staff_details WHERE teacher_code ~ '^VT[0-9]{11}$')
);

ALTER TABLE vt_staff_details
  ALTER COLUMN teacher_code SET NOT NULL;

ALTER TABLE vt_staff_details
  DROP CONSTRAINT IF EXISTS vt_staff_details_teacher_code_format_check;
ALTER TABLE vt_staff_details
  ADD CONSTRAINT vt_staff_details_teacher_code_format_check
  CHECK (teacher_code ~ '^VT[0-9]{11}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_vt_staff_details_teacher_code
  ON vt_staff_details (teacher_code);

COMMIT;
