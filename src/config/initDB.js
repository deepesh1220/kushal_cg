const { pool } = require('./db');

const initDB = async () => {
  const client = await pool.connect();

  try {
    console.log('🔧 Initializing database tables...');

    await client.query('BEGIN');

    // ─────────────────────────────────────────────────────────
    // TABLE: vt_staff_details
    // Master list of vocational teachers imported from govt data
    // Registration is only allowed if mobile exists here
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS vt_staff_details (
        id            INTEGER      PRIMARY KEY,
        district_name VARCHAR(100),
        block_name    VARCHAR(100),
        school_name   VARCHAR(200),
        udise_code    BIGINT,
        vtp_name      VARCHAR(100),
        vt_name       VARCHAR(150),
        trade         VARCHAR(100),
        vt_mob        BIGINT      ,
        vtp_pan       VARCHAR(15),
        vt_aadhar     BIGINT,
        vt_email      VARCHAR(150),
        school_type   VARCHAR(100),
        old_or_new    VARCHAR(50),
        vtp_id        CHAR(2),
        remarks       TEXT
      );
    `);

    // Ensure profile-extension columns exist on vt_staff_details
    await client.query(`
      ALTER TABLE vt_staff_details
        ADD COLUMN IF NOT EXISTS dob                      DATE,
        ADD COLUMN IF NOT EXISTS educational_qualification VARCHAR(200),
        ADD COLUMN IF NOT EXISTS date_of_joining          DATE,
        ADD COLUMN IF NOT EXISTS vtp_id                   CHAR(2),
        ADD COLUMN IF NOT EXISTS old_mobile_number        BIGINT,
        ADD COLUMN IF NOT EXISTS mobile_number_approved_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS vtp_mobile_approved_status VARCHAR(20) DEFAULT 'approved',
        ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ DEFAULT NOW();

      ALTER TABLE vt_staff_details DROP CONSTRAINT IF EXISTS vt_staff_details_mobile_approval_status_check;
      ALTER TABLE vt_staff_details ADD CONSTRAINT vt_staff_details_mobile_approval_status_check
        CHECK (vtp_mobile_approved_status IN ('pending','approved','rejected'));
      UPDATE vt_staff_details SET vtp_mobile_approved_status = 'approved'
        WHERE vtp_mobile_approved_status IS NULL;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: roles
    // Stores dynamic roles (admin, teacher, student, hr, etc.)
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(50)  UNIQUE NOT NULL,
        description TEXT,
        is_active   BOOLEAN      DEFAULT TRUE,
        created_at  TIMESTAMPTZ  DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: permissions
    // Fine-grained permissions like 'attendance:create'
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) UNIQUE NOT NULL,
        module      VARCHAR(50)  NOT NULL,
        action      VARCHAR(50)  NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: role_permissions  (many-to-many)
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id            SERIAL PRIMARY KEY,
        role_id       INTEGER NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        UNIQUE (role_id, permission_id)
      );
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: users
    // Core user table linked to a role
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                 SERIAL PRIMARY KEY,
        name               VARCHAR(100) NOT NULL,
        email              VARCHAR(150) UNIQUE NOT NULL,
        phone              BIGINT       UNIQUE,
        password_hash      TEXT         NOT NULL,
        role_id            INTEGER      REFERENCES roles(id) ON DELETE SET NULL,
        vt_staff_id        INTEGER      REFERENCES vt_staff_details(id) ON DELETE SET NULL,
        organization_name  VARCHAR(150),
        udise_code         BIGINT,
        latitude           FLOAT,
        longitude          FLOAT,
        school_open_time   TIME,
        school_close_time  TIME,
        vt_approval_status VARCHAR(20)  DEFAULT NULL
                             CHECK (vt_approval_status IN ('pending','accepted','rejected')),
        vtp_approval_status VARCHAR(20) DEFAULT NULL
                             CHECK (vtp_approval_status IN ('pending','accepted','rejected')),
        vtp_id             CHAR(2),
        is_active          BOOLEAN      DEFAULT TRUE,
        profile_photo      TEXT,
        created_at         TIMESTAMPTZ  DEFAULT NOW(),
        updated_at         TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    // Ensure face_descriptor column exists on users (biometric — stored AES-256-GCM encrypted)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS face_descriptor TEXT DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS device_id_hash VARCHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS device_updated_at TIMESTAMPTZ;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: user_permissions  (override — per user grant/revoke)
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        is_granted    BOOLEAN DEFAULT TRUE,
        UNIQUE (user_id, permission_id)
      );
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: refresh_tokens
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT        NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS device_change_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_device_id_hash VARCHAR(64) NOT NULL,
        previous_device_id_hash VARCHAR(64),
        reason TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        hm_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (hm_status IN ('pending','approved','rejected')),
        hm_approved_by INTEGER REFERENCES users(id), hm_approved_at TIMESTAMPTZ, hm_remarks TEXT,
        vtp_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (vtp_status IN ('pending','approved','rejected')),
        vtp_approved_by INTEGER REFERENCES users(id), vtp_approved_at TIMESTAMPTZ, vtp_remarks TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_device_change_pending_user
        ON device_change_requests(user_id) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_device_change_user_created
        ON device_change_requests(user_id, created_at DESC);
    `);
    await client.query(`ALTER TABLE device_change_requests
      ADD COLUMN IF NOT EXISTS previous_device_id_hash VARCHAR(64);`);

    // ─────────────────────────────────────────────────────────
    // TABLE: attendance_records
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date            DATE        NOT NULL,
        check_in_time   TIMESTAMPTZ,
        check_out_time  TIMESTAMPTZ,
        status          VARCHAR(20) DEFAULT 'present'
                          CHECK (status IN ('present','absent','late','half_day','on_leave','od')),
        latitude        NUMERIC(10, 8),
        longitude       NUMERIC(11, 8),
        checkout_latitude NUMERIC(10, 8),
        checkout_longitude NUMERIC(11, 8),
        photo_path      TEXT,
        remarks         TEXT,
        marked_by       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, date)
      );
    `);

    // Ensure checkout location columns exist for previously created databases
    await client.query(`
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS checkout_latitude    NUMERIC(10, 8);
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS checkout_longitude   NUMERIC(11, 8);
    `);

    // ── Face recognition columns ─────────────────────────────────────────────
    await client.query(`
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS face_match_score     NUMERIC(5,2) DEFAULT NULL;
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS checkin_photo        TEXT         DEFAULT NULL;
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS checkout_photo       TEXT         DEFAULT NULL;
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS checkout_face_score  NUMERIC(5,2) DEFAULT NULL;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: leave_requests
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_date    DATE    NOT NULL,
        to_date      DATE    NOT NULL,
        leave_type   VARCHAR(20) DEFAULT 'full-day'
                       CHECK (leave_type IN ('full-day','first-half','second-half','od','regularization')),
        reason       TEXT,
        status       VARCHAR(20) DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
        reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Ensure leave_type column exists for previously created databases
    await client.query(`
      ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_type VARCHAR(20) DEFAULT 'full-day';
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: leave_balance
    // Tracks earned leave (EL) balance for each VT
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_balance (
        id                SERIAL PRIMARY KEY,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opening_balance   DECIMAL(5,2) DEFAULT 0.00,    -- Opening balance at year start (= previous year closing capped)
        total_earned      DECIMAL(5,2) DEFAULT 0.00,    -- Total EL credited this financial year (capped 13)
        total_used        DECIMAL(5,2) DEFAULT 0.00,    -- Total EL used this year
        remaining_balance DECIMAL(5,2) DEFAULT 0.00,    -- Current available balance
        carried_forward   DECIMAL(5,2) DEFAULT 0.00,    -- Leave carried from previous year
        closing_balance   DECIMAL(5,2) DEFAULT 0.00,    -- Closing balance at year end (set by year-end job)
        year              INTEGER DEFAULT EXTRACT(YEAR FROM NOW()),
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, year)
      );
    `);

    // Backfill opening_balance & closing_balance columns on existing DBs
    await client.query(`ALTER TABLE leave_balance ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(5,2) DEFAULT 0.00;`);
    await client.query(`ALTER TABLE leave_balance ADD COLUMN IF NOT EXISTS closing_balance DECIMAL(5,2) DEFAULT 0.00;`);

    // ─────────────────────────────────────────────────────────
    // TABLE: monthly_leave_credit_log
    // Audit log for annual EL credit (April 1 = Indian FY start).
    // month=4 marks the annual credit; month=0 marks manual adjustments.
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_leave_credit_log (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        year           INTEGER NOT NULL,
        month          INTEGER NOT NULL,  -- 4 = annual FY credit marker; 0 = manual adjustment
        credited_leave DECIMAL(5,2) DEFAULT 13.0,
        credited_at    TIMESTAMPTZ DEFAULT NOW(),
        status         VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'failed', 'skipped')),
        error_message  TEXT,
        UNIQUE (user_id, year, month)
      );
    `);

    // Update default for existing databases migrating from monthly (1.5) to annual (13.0) credit
    await client.query(`
      ALTER TABLE monthly_leave_credit_log ALTER COLUMN credited_leave SET DEFAULT 13.0;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: leave_deduction_log
    // Audit log for leave deductions when approved
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_deduction_log (
        id              SERIAL PRIMARY KEY,
        leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deducted_amount  DECIMAL(3,1) NOT NULL,  -- 1.0 for full-day, 0.5 for half-day
        leave_type       VARCHAR(20) NOT NULL,
        deducted_at      TIMESTAMPTZ DEFAULT NOW(),
        reviewed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: leave_excess_records
    // Tracks excess/access leave taken when remaining_balance is insufficient
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_excess_records (
        id                                 SERIAL PRIMARY KEY,
        user_id                            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        leave_request_id                   INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
        month                              INTEGER NOT NULL,
        year                               INTEGER NOT NULL,
        approved_leave_days                DECIMAL(5,2) NOT NULL,
        available_balance_before_deduction DECIMAL(5,2) NOT NULL,
        deducted_from_balance              DECIMAL(5,2) NOT NULL,
        excess_leave                       DECIMAL(5,2) NOT NULL,
        created_at                         TIMESTAMPTZ DEFAULT NOW(),
        updated_at                         TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // A fully-approved leave can later be cancelled for a particular date.
    // Keep the request-level decision visible while the cancellation table
    // remains the source of truth for the exact cancelled date(s).
    await client.query(`
      ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
      ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check
        CHECK (status IN ('pending','approved','rejected','cancelled'));
    `);

    // Current-day cancellation requests for already approved leaves.
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_cancellation_requests (
        id               SERIAL PRIMARY KEY,
        leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cancel_date       DATE NOT NULL,
        reason            TEXT NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected')),
        reviewed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_remarks  TEXT,
        reviewed_at       TIMESTAMPTZ,
        hm_status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (hm_status IN ('pending','approved','rejected')),
        hm_approved_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        hm_approved_at    TIMESTAMPTZ,
        hm_remarks        TEXT,
        vtp_status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (vtp_status IN ('pending','approved','rejected')),
        vtp_approved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        vtp_approved_at   TIMESTAMPTZ,
        vtp_remarks       TEXT,
        refunded_amount   DECIMAL(5,2) NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (leave_request_id, cancel_date)
      );
      CREATE INDEX IF NOT EXISTS idx_leave_cancellation_user_date
        ON leave_cancellation_requests(user_id, cancel_date);
      CREATE INDEX IF NOT EXISTS idx_leave_cancellation_status
        ON leave_cancellation_requests(status);
    `);

    await client.query(`
      ALTER TABLE leave_cancellation_requests
        ADD COLUMN IF NOT EXISTS hm_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS hm_approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS hm_approved_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS hm_remarks TEXT,
        ADD COLUMN IF NOT EXISTS vtp_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS vtp_approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS vtp_approved_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS vtp_remarks TEXT;
      ALTER TABLE leave_cancellation_requests DROP CONSTRAINT IF EXISTS leave_cancellation_requests_hm_status_check;
      ALTER TABLE leave_cancellation_requests ADD CONSTRAINT leave_cancellation_requests_hm_status_check
        CHECK (hm_status IN ('pending','approved','rejected'));
      ALTER TABLE leave_cancellation_requests DROP CONSTRAINT IF EXISTS leave_cancellation_requests_vtp_status_check;
      ALTER TABLE leave_cancellation_requests ADD CONSTRAINT leave_cancellation_requests_vtp_status_check
        CHECK (vtp_status IN ('pending','approved','rejected'));
      UPDATE leave_cancellation_requests
      SET hm_status = 'approved', vtp_status = 'approved'
      WHERE status = 'approved';
      UPDATE leave_cancellation_requests
      SET hm_status = 'rejected', vtp_status = 'rejected'
      WHERE status = 'rejected';
    `);

    // Indexes for leave balance tables
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leave_balance_user_id ON leave_balance(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leave_balance_year ON leave_balance(year);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_credit_log_user_id ON monthly_leave_credit_log(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_credit_log_year_month ON monthly_leave_credit_log(year, month);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leave_deduction_user_id ON leave_deduction_log(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leave_deduction_leave_id ON leave_deduction_log(leave_request_id);`);

    // ─────────────────────────────────────────────────────────
    // TABLE: headmasters  (kushal_cg domain)
    // Stores headmaster / principal records synced from MIS.
    // teacher_code is the natural PK assigned by the MIS system.
    // All column names use snake_case per project convention.
    // ─────────────────────────────────────────────────────────
    // ⚠️  MIGRATION HELPER: drops the old table so it is recreated with the
    //     correct snake_case column names. Remove this line once the schema
    //     is stable and the table holds real data.

    await client.query(`
      CREATE TABLE IF NOT EXISTS headmasters (
        -- ── Identity / Auth ────────────────────────────────────
        teacher_code          VARCHAR(120)     NOT NULL,   -- PK, assigned by MIS
        email                 VARCHAR(255),
        password              VARCHAR(255)     NOT NULL,   -- bcrypt hash
        t_name                VARCHAR(255)     NOT NULL,   -- full name

        -- ── School / Admin hierarchy ───────────────────────────
        udise_code            BIGINT,
        school_name           VARCHAR(255),
        cluster_id            BIGINT,
        cluster_name          VARCHAR(255),
        block_id              BIGINT,
        block_name            VARCHAR(255),
        district_id           BIGINT,
        district_name         VARCHAR(255),

        -- ── Personal details ───────────────────────────────────
        gender                INT,             -- 1=Male 2=Female 3=Other
        caste_name            TEXT,
        mobile                BIGINT,
        dob                   DATE,

        -- ── Role / Status flags ────────────────────────────────
        role                                  TEXT     DEFAULT 'headmaster',
        is_migrated                           BOOLEAN  DEFAULT FALSE,
        is_attached_teacher                   BOOLEAN  DEFAULT FALSE,
        is_role_update                        BOOLEAN  DEFAULT FALSE,
        is_location_reset                     BOOLEAN  DEFAULT FALSE,
        location_verify                       BOOLEAN  DEFAULT FALSE,
        appoint_as_cac                        BOOLEAN  DEFAULT FALSE,
        is_retired_teacher                    BOOLEAN  DEFAULT FALSE,
        is_temporary_headmaster_or_principal  BOOLEAN  DEFAULT FALSE,

        -- ── Verification / Approval ────────────────────────────
        verified_by_headmaster  BOOLEAN        DEFAULT FALSE,
        approved_by_headmaster  BOOLEAN        DEFAULT FALSE,

        -- ── School management / Category ──────────────────────
        sch_mgmt_id             INT,
        sch_category_id         INT,

        -- ── Media / Location ───────────────────────────────────
        school_image_url        TEXT,
        latitude                DOUBLE PRECISION,
        longitude               DOUBLE PRECISION,

        -- ── Timestamps ─────────────────────────────────────────
        updated_at              TIMESTAMPTZ    DEFAULT NOW(),
        created_at              TIMESTAMPTZ    DEFAULT NOW(),

        -- ── Constraints ────────────────────────────────────────
        CONSTRAINT headmasters_pkey         PRIMARY KEY (teacher_code),
        CONSTRAINT headmasters_email_unique UNIQUE (email)
      );
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: mst_deo
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mst_deo (
         id SERIAL PRIMARY KEY,
         district_cd INTEGER,
         district_name VARCHAR(200),
	       deo_name VARCHAR(255) NOT NULL,
         mobile BIGINT,
	       alternate_mobile BIGINT,
         designation VARCHAR(50),
	       email VARCHAR(200) UNIQUE default null
      );
    `);

    // ─────────────────────────────────────────────────────────
    // ALTER TABLE: mst_schools
    // ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE IF EXISTS mst_schools ADD COLUMN IF NOT EXISTS sch_open_time TIME;
      ALTER TABLE IF EXISTS mst_schools ADD COLUMN IF NOT EXISTS sch_close_time TIME;
      ALTER TABLE IF EXISTS mst_schools ADD COLUMN IF NOT EXISTS grace_time INTEGER;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: monthly_school_reports
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_school_reports (
        id SERIAL PRIMARY KEY,
        udise_code BIGINT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_month INTEGER NOT NULL,
        report_year INTEGER NOT NULL,
        hm_approval_status VARCHAR(20) DEFAULT 'pending' CHECK (hm_approval_status IN ('pending', 'approved', 'rejected')),
        vtp_approval_status VARCHAR(20) DEFAULT 'pending' CHECK (vtp_approval_status IN ('pending', 'approved', 'rejected')),
        deo_approval_status VARCHAR(20) DEFAULT 'pending' CHECK (deo_approval_status IN ('pending', 'approved', 'rejected')),
        hm_remarks TEXT,
        vtp_remarks TEXT,
        deo_remarks TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, report_month, report_year)
      );
    `);

    // Ensure user_id column exists for existing tables and update constraints
    await client.query(`
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE monthly_school_reports DROP CONSTRAINT IF EXISTS monthly_school_reports_udise_code_report_month_report_y_key;
      ALTER TABLE monthly_school_reports DROP CONSTRAINT IF EXISTS monthly_school_reports_udise_code_report_month_report_year_key;
      ALTER TABLE monthly_school_reports DROP CONSTRAINT IF EXISTS monthly_school_reports_user_id_report_month_report_year_key;
      ALTER TABLE monthly_school_reports ADD CONSTRAINT monthly_school_reports_user_id_report_month_report_year_key UNIQUE (user_id, report_month, report_year);
    `);

    // ─────────────────────────────────────────────────────────
    // ALTER monthly_school_reports: approval audit columns
    // Added for 3-level sequential approval workflow
    // ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS hm_approved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS hm_approved_at   TIMESTAMPTZ;
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS deo_approved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS deo_approved_at  TIMESTAMPTZ;
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS vtp_approved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS vtp_approved_at  TIMESTAMPTZ;
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS is_locked        BOOLEAN DEFAULT FALSE;
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS hm_approval_type  VARCHAR(10);
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS deo_approval_type VARCHAR(10);
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS vtp_approval_type VARCHAR(10);
      ALTER TABLE monthly_school_reports ADD COLUMN IF NOT EXISTS is_auto_approved  BOOLEAN DEFAULT FALSE;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: monthly_report_snapshots
    // Immutable attendance snapshot taken at report generation.
    // PDF is always regenerated from this snapshot so the report
    // content never changes after it is locked by approvals.
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_report_snapshots (
        id            SERIAL PRIMARY KEY,
        report_id     INTEGER     NOT NULL REFERENCES monthly_school_reports(id) ON DELETE CASCADE,
        user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month         INTEGER     NOT NULL,
        year          INTEGER     NOT NULL,
        snapshot_data JSONB       NOT NULL,
        generated_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, month, year)
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_rpt_snapshots_report_id       ON monthly_report_snapshots(report_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rpt_snapshots_user_month_year ON monthly_report_snapshots(user_id, month, year);`);

    // ─────────────────────────────────────────────────────────
    // ALTER CONSTRAINTS for OD feature
    // ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
      ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_leave_type_check CHECK (leave_type IN ('full-day','first-half','second-half','od','regularization'));

      ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
      ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_status_check CHECK (status IN ('present','absent','late','half_day','on_leave','od'));
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: od_requests
    // Dedicated On-Duty request table (separate from leave_requests)
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS od_requests (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_date    DATE    NOT NULL,
        to_date      DATE    NOT NULL,
        od_type      VARCHAR(20) DEFAULT 'full-day'
                       CHECK (od_type IN ('full-day','first-half','second-half')),
        reason       TEXT,
        status       VARCHAR(20) DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
        reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE od_requests ADD COLUMN IF NOT EXISTS od_type VARCHAR(20) DEFAULT 'full-day';
      ALTER TABLE od_requests DROP CONSTRAINT IF EXISTS od_requests_od_type_check;
      ALTER TABLE od_requests ADD CONSTRAINT od_requests_od_type_check CHECK (od_type IN ('full-day','first-half','second-half'));
    `);

    // ─────────────────────────────────────────────────────────
    // ALTER od_requests: add dual-approval layer
    // ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE od_requests
        ADD COLUMN IF NOT EXISTS hm_status          VARCHAR(20) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS hm_approved_by     INTEGER     REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS hm_action_at       TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS hm_remarks         TEXT,
        ADD COLUMN IF NOT EXISTS vtp_status         VARCHAR(20) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS vtp_approved_by    INTEGER     REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS vtp_action_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS vtp_remarks        TEXT,
        ADD COLUMN IF NOT EXISTS od_approved        BOOLEAN     DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS hm_approval_type   VARCHAR(10),
        ADD COLUMN IF NOT EXISTS vtp_approval_type  VARCHAR(10),
        ADD COLUMN IF NOT EXISTS is_auto_approved   BOOLEAN     DEFAULT FALSE;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: regularization_requests
    // Dedicated single-date attendance regularization table
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS regularization_requests (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date         DATE    NOT NULL,
        reason       TEXT    NOT NULL,
        status       VARCHAR(20) DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
        reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, date)
      );
      `);

    // ─────────────────────────────────────────────────────────
    // TABLE: vtp
    // Vocational Trainer Provider master table.
    // VTP users can log in via /auth/web/login with role_id for
    // 'vocational_teacher_provider'.
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS vtp (
        id                           SERIAL       PRIMARY KEY,
        vc_name  VARCHAR(200) NOT NULL,
        vtp_name                     VARCHAR(200) NOT NULL,
        mobile                BIGINT       UNIQUE NOT NULL,
        email                        VARCHAR(200) UNIQUE NOT NULL,
        vtp_id                       CHAR(2),
        status                       VARCHAR(20)  DEFAULT 'active'
                                       CHECK (status IN ('active','inactive')),
        created_at                   TIMESTAMPTZ  DEFAULT NOW(),
        updated_at                   TIMESTAMPTZ  DEFAULT NOW()
      );
    `);


    // Indexes for VTP table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vtp_email   ON vtp (email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vtp_mobile  ON vtp (mobile);`);

    // Ensure vtp_id column exists on vtp table
    await client.query(`
      ALTER TABLE vtp
        ADD COLUMN IF NOT EXISTS vtp_id CHAR(2);
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: mst_vtp
    // Master table for Vocational Trainer Providers
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mst_vtp (
        vtp_id   CHAR(2) PRIMARY KEY,
        vtp_name VARCHAR(100) NOT NULL UNIQUE
      );
    `);

    // Seed data for mst_vtp
    await client.query(`
      INSERT INTO mst_vtp (vtp_id, vtp_name) VALUES
        ('21', 'Aisect'),
        ('22', 'Gram Tarang'),
        ('23', 'Indus'),
        ('24', 'Laqsh'),
        ('25', 'Learnet Skills Limited'),
        ('26', 'Nitcon'),
        ('27', 'Skill Tree'),
        ('28', 'Upgrad')
      ON CONFLICT (vtp_id) DO UPDATE 
      SET vtp_name = EXCLUDED.vtp_name;
    `);

    // Auto-populate vtp_id in vt_staff_details and vtp by matching vtp_name
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS vtp_id CHAR(2);

      UPDATE vt_staff_details
      SET vtp_id = mst_vtp.vtp_id
      FROM mst_vtp
      WHERE vt_staff_details.vtp_name = mst_vtp.vtp_name
      AND vt_staff_details.vtp_id IS DISTINCT FROM mst_vtp.vtp_id;

      UPDATE vtp
      SET vtp_id = mst_vtp.vtp_id
      FROM mst_vtp
      WHERE vtp.vtp_name = mst_vtp.vtp_name
      AND vtp.vtp_id IS DISTINCT FROM mst_vtp.vtp_id;

      -- Populate users table based on organization_name (for VTP/management users)
      UPDATE users
      SET vtp_id = mst_vtp.vtp_id
      FROM mst_vtp
      WHERE users.organization_name = mst_vtp.vtp_name
      AND users.vtp_id IS DISTINCT FROM mst_vtp.vtp_id;

      -- Populate users table based on vt_staff_details (for VT users)
      UPDATE users
      SET vtp_id = vt_staff_details.vtp_id
      FROM vt_staff_details
      WHERE users.vt_staff_id = vt_staff_details.id
      AND vt_staff_details.vtp_id IS NOT NULL
      AND users.vtp_id IS DISTINCT FROM vt_staff_details.vtp_id;
    `);

    // ALTER users: add vtp_approval_status (dual-approval layer)
    // ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vtp_approval_status VARCHAR(20) DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vt_approval_remarks TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vtp_approval_remarks TEXT;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_vtp_approval_status_check;
      ALTER TABLE users ADD CONSTRAINT users_vtp_approval_status_check
        CHECK (vtp_approval_status IS NULL OR vtp_approval_status IN ('pending','accepted','rejected'));
      -- Backfill: any existing VT (vt_approval_status NOT NULL) without vtp_approval_status starts as 'pending'
      UPDATE users SET vtp_approval_status = 'pending'
        WHERE vt_approval_status IS NOT NULL AND vtp_approval_status IS NULL;
    `);

    // ─────────────────────────────────────────────────────────
    // ALTER users: audit timestamps for each approval layer
    //   principal_updated_at  → set whenever vt_approval_status changes  (HM/Principal layer)
    //   vtp_updated_at        → set whenever vtp_approval_status changes  (VTP layer)
    // ─────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────
    // ALTER leave_requests: add dual-approval layer
    // ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS vtp_status VARCHAR(20) DEFAULT 'pending';
      ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_vtp_status_check;
      ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_vtp_status_check
        CHECK (vtp_status IN ('pending','approved','rejected'));

      ALTER TABLE leave_requests
        ADD COLUMN IF NOT EXISTS principal_updated_at TIMESTAMPTZ DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS vtp_updated_at       TIMESTAMPTZ DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS principal_remarks    TEXT,
        ADD COLUMN IF NOT EXISTS vtp_remarks          TEXT,
        ADD COLUMN IF NOT EXISTS leave_approved       BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS principal_approval_type VARCHAR(10),
        ADD COLUMN IF NOT EXISTS vtp_approval_type       VARCHAR(10),
        ADD COLUMN IF NOT EXISTS is_auto_approved        BOOLEAN DEFAULT FALSE;
    `);

    await client.query(`
      ALTER TABLE regularization_requests
        ADD COLUMN IF NOT EXISTS review_remarks            TEXT,
        ADD COLUMN IF NOT EXISTS hm_status                 VARCHAR(20) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS hm_approved_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS hm_action_at              TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS hm_remarks                TEXT,
        ADD COLUMN IF NOT EXISTS vtp_status                VARCHAR(20) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS vtp_approved_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS vtp_action_at             TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS vtp_remarks               TEXT,
        ADD COLUMN IF NOT EXISTS regularization_approved   BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS hm_approval_type          VARCHAR(10),
        ADD COLUMN IF NOT EXISTS vtp_approval_type         VARCHAR(10),
        ADD COLUMN IF NOT EXISTS is_auto_approved          BOOLEAN DEFAULT FALSE;

      ALTER TABLE regularization_requests
        DROP CONSTRAINT IF EXISTS regularization_requests_hm_status_check;
      ALTER TABLE regularization_requests
        ADD CONSTRAINT regularization_requests_hm_status_check
          CHECK (hm_status IN ('pending','approved','rejected'));
      ALTER TABLE regularization_requests
        DROP CONSTRAINT IF EXISTS regularization_requests_vtp_status_check;
      ALTER TABLE regularization_requests
        ADD CONSTRAINT regularization_requests_vtp_status_check
          CHECK (vtp_status IN ('pending','approved','rejected'));

      -- Preserve completed legacy decisions. New and pending requests require both layers.
      UPDATE regularization_requests
      SET hm_status = CASE
            WHEN status = 'approved' THEN 'approved'
            WHEN status = 'rejected' THEN 'rejected'
            ELSE COALESCE(hm_status, 'pending')
          END,
          vtp_status = CASE
            WHEN status = 'approved' THEN 'approved'
            ELSE COALESCE(vtp_status, 'pending')
          END,
          regularization_approved = (status = 'approved'),
          hm_approved_by = CASE WHEN status IN ('approved','rejected') THEN COALESCE(hm_approved_by, reviewed_by) ELSE hm_approved_by END,
          hm_action_at = CASE WHEN status IN ('approved','rejected') THEN COALESCE(hm_action_at, reviewed_at) ELSE hm_action_at END,
          hm_remarks = CASE WHEN status IN ('approved','rejected') THEN COALESCE(hm_remarks, review_remarks) ELSE hm_remarks END
      WHERE reviewed_by IS NOT NULL AND hm_approved_by IS NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auto_approval_logs (
        id BIGSERIAL PRIMARY KEY,
        entity_type VARCHAR(40) NOT NULL,
        entity_id INTEGER NOT NULL,
        approval_layer VARCHAR(20) NOT NULL,
        eligible_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW(),
        status VARCHAR(20) NOT NULL CHECK (status IN ('success','failed','skipped')),
        error_message TEXT,
        UNIQUE (entity_type, entity_id, approval_layer)
      );
      CREATE INDEX IF NOT EXISTS idx_auto_approval_logs_entity
        ON auto_approval_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_leave_auto_approval_due
        ON leave_requests(created_at) WHERE status = 'pending' OR vtp_status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_od_auto_approval_due
        ON od_requests(created_at) WHERE hm_status = 'pending' OR vtp_status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_regularization_auto_approval_due
        ON regularization_requests(created_at) WHERE hm_status = 'pending' OR vtp_status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_monthly_reports_auto_approval_due
        ON monthly_school_reports(created_at, hm_approved_at, deo_approved_at)
        WHERE is_locked = FALSE;

      UPDATE leave_requests SET principal_approval_type = 'manual'
        WHERE status IN ('approved','rejected') AND principal_approval_type IS NULL;
      UPDATE leave_requests SET vtp_approval_type = 'manual'
        WHERE vtp_status IN ('approved','rejected') AND vtp_approval_type IS NULL;
      UPDATE od_requests SET hm_approval_type = 'manual'
        WHERE hm_status IN ('approved','rejected') AND hm_approval_type IS NULL;
      UPDATE od_requests SET vtp_approval_type = 'manual'
        WHERE vtp_status IN ('approved','rejected') AND vtp_approval_type IS NULL;
      UPDATE regularization_requests SET hm_approval_type = 'manual'
        WHERE hm_status IN ('approved','rejected') AND hm_approval_type IS NULL;
      UPDATE regularization_requests SET vtp_approval_type = 'manual'
        WHERE vtp_status IN ('approved','rejected') AND vtp_approval_type IS NULL;
      UPDATE monthly_school_reports SET hm_approval_type = 'manual'
        WHERE hm_approval_status IN ('approved','rejected') AND hm_approval_type IS NULL;
      UPDATE monthly_school_reports SET deo_approval_type = 'manual'
        WHERE deo_approval_status IN ('approved','rejected') AND deo_approval_type IS NULL;
      UPDATE monthly_school_reports SET vtp_approval_type = 'manual'
        WHERE vtp_approval_status IN ('approved','rejected') AND vtp_approval_type IS NULL;
    `);

    // ─────────────────────────────────────────────────────────
    // TABLE: mst_holiday
    // Master table for official holidays
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mst_holiday (
        holiday_id    SERIAL PRIMARY KEY,
        holiday_date  DATE NOT NULL,
        month_name    VARCHAR(20) NOT NULL,
        year          INTEGER NOT NULL,
        holiday_name  VARCHAR(255) NOT NULL,
        weekday_name  VARCHAR(20) NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (holiday_date, holiday_name)
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_mst_holiday_year ON mst_holiday(year);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mst_holiday_date ON mst_holiday(holiday_date);`);

    // ─────────────────────────────────────────────────────────
    // TABLE: school_generated_holidays
    // Principal-declared school-specific holidays
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS school_generated_holidays (
        generated_holiday_id    SERIAL PRIMARY KEY,
        principal_name          VARCHAR(150) NOT NULL,
        principal_mobile_number VARCHAR(20) NOT NULL,
        udise_code              VARCHAR(30) NOT NULL,
        school_name             VARCHAR(255) NOT NULL,
        holiday_description     TEXT NOT NULL,
        generated_holiday_date  DATE NOT NULL,
        remarks                 TEXT,
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (udise_code, generated_holiday_date)
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_gen_holidays_udise ON school_generated_holidays(udise_code);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gen_holidays_date  ON school_generated_holidays(generated_holiday_date);`);

    await client.query('COMMIT');
    console.log('✅ All tables created/verified successfully');

    // Indexes outside transaction (idempotent — IF NOT EXISTS)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_headmasters_udise_code    ON headmasters (udise_code);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_headmasters_mobile      ON headmasters (mobile);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_headmasters_district_id ON headmasters (district_id);`);
    console.log('✅ Headmaster indexes created/verified');

    // ─────────────────────────────────────────────────────────
    // SEED: Default roles and permissions
    // ─────────────────────────────────────────────────────────
    await seedDefaults(client);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

// ─── Seed Default Roles & Permissions ───────────────────────────────────────────
const seedDefaults = async (client) => {
  // ── 6 domain-specific roles ──────────────────────────────────────────────────
  const defaultRoles = [
    {
      name: 'super_admin',
      description: 'Full system access — manage everything including roles, permissions, and users',
    },
    {
      name: 'admin',
      description: 'Manage users, Vocational Trainer records, reports, and approve leaves',
    },
    {
      name: 'deo',
      description: 'District Education Officer — enter and update Vocational Trainer data on behalf of teachers',
    },
    {
      name: 'headmaster',
      description: 'School head — view all Vocational Trainer records, approve leaves, access reports',
    },
    {
      name: 'vocational_teacher_provider',
      description: 'Provider organisation — view and manage their assigned vocational teachers',
    },
    {
      name: 'vocational_teacher',
      description: 'Vocational teacher — mark own Vocational Trainer status and submit leave requests',
    },
    {
      name: 'programmer',
      description: 'Programmer — enter and update Vocational Trainer data on behalf of headmaster and teachers',
    },
  ];

  for (const role of defaultRoles) {
    await client.query(`
      INSERT INTO roles (name, description)
      VALUES ($1, $2)
      ON CONFLICT (name) DO NOTHING
    `, [role.name, role.description]);
  }

  // Default permissions  [module:action]
  const defaultPermissions = [
    // ── User management ──────────────────────────────────────────────────────
    { name: 'users:view', module: 'users', action: 'view', description: 'View all users' },
    { name: 'users:create', module: 'users', action: 'create', description: 'Create new users' },
    { name: 'users:update', module: 'users', action: 'update', description: 'Update user details' },
    { name: 'users:delete', module: 'users', action: 'delete', description: 'Delete users' },
    // ── Role management ──────────────────────────────────────────────────────
    { name: 'roles:view', module: 'roles', action: 'view', description: 'View all roles' },
    { name: 'roles:create', module: 'roles', action: 'create', description: 'Create roles' },
    { name: 'roles:update', module: 'roles', action: 'update', description: 'Update roles' },
    { name: 'roles:delete', module: 'roles', action: 'delete', description: 'Delete roles' },
    { name: 'roles:assign', module: 'roles', action: 'assign', description: 'Assign roles to users' },
    // ── Attendance ───────────────────────────────────────────────────────────
    { name: 'attendance:view_own', module: 'attendance', action: 'view_own', description: 'View own Vocational Trainer records only' },
    { name: 'attendance:view_all', module: 'attendance', action: 'view_all', description: 'View Vocational Trainer records of all users' },
    { name: 'attendance:view_teachers', module: 'attendance', action: 'view_teachers', description: 'View Vocational Trainer records of assigned vocational teachers' },
    { name: 'attendance:create', module: 'attendance', action: 'create', description: 'Mark own Vocational Trainer status' },
    { name: 'attendance:create_others', module: 'attendance', action: 'create_others', description: 'Mark Vocational Trainer status on behalf of others (DEO)' },
    { name: 'attendance:update', module: 'attendance', action: 'update', description: 'Edit or correct Vocational Trainer records' },
    { name: 'attendance:delete', module: 'attendance', action: 'delete', description: 'Delete Vocational Trainer records' },
    { name: 'attendance:report', module: 'attendance', action: 'report', description: 'Generate and view Vocational Trainer reports' },
    // ── Leave ────────────────────────────────────────────────────────────────
    { name: 'leave:request', module: 'leave', action: 'request', description: 'Submit a leave request' },
    { name: 'leave:view_own', module: 'leave', action: 'view_own', description: 'View own leave requests' },
    { name: 'leave:view_all', module: 'leave', action: 'view_all', description: 'View leave requests of all users' },
    { name: 'leave:approve', module: 'leave', action: 'approve', description: 'Approve or reject leave requests' },
    { name: 'leave:view_balance_own', module: 'leave', action: 'view_balance_own', description: 'View own leave balance' },
    { name: 'leave:view_balance_all', module: 'leave', action: 'view_balance_all', description: 'View leave balance of all users' },
    { name: 'leave:manage_balance', module: 'leave', action: 'manage_balance', description: 'Manage leave credits and adjustments' },
    // ── Permissions management ───────────────────────────────────────────────
    { name: 'permissions:manage', module: 'permissions', action: 'manage', description: 'Manage system permissions' },
    // ── VT Approval ─────────────────────────────────────────────────────────
    { name: 'vt:approve', module: 'vt', action: 'approve', description: 'Approve or reject Vocational Teacher registrations (Principal/HM layer)' },
    { name: 'vt:approve_vtp', module: 'vt', action: 'approve_vtp', description: 'Approve or reject Vocational Teacher registrations (VTP layer)' },
    // ── Monthly Report Workflow ───────────────────────────────────────────────
    { name: 'reports:generate',     module: 'reports', action: 'generate',     description: 'Generate monthly VT Vocational Trainer report PDF snapshot' },
    { name: 'reports:view_monthly', module: 'reports', action: 'view_monthly', description: 'View monthly VT Vocational Trainer report list' },
    { name: 'reports:approve_hm',   module: 'reports', action: 'approve_hm',   description: 'Principal/HM: approve monthly VT report (layer 1)' },
    { name: 'reports:approve_deo',  module: 'reports', action: 'approve_deo',  description: 'DEO: approve monthly VT report (layer 2, requires HM approval)' },
    { name: 'reports:approve_vtp',  module: 'reports', action: 'approve_vtp',  description: 'VTP: final approve monthly VT report (layer 3, requires HM+DEO approval)' },
  ];

  for (const perm of defaultPermissions) {
    await client.query(`
      INSERT INTO permissions (name, module, action, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (name) DO NOTHING
    `, [perm.name, perm.module, perm.action, perm.description]);
  }

  // ─── Helper: assign permissions to a named role ──────────────────────────────
  const assignPerms = async (roleName, permNames) => {
    for (const perm of permNames) {
      await client.query(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r, permissions p
        WHERE r.name = $1 AND p.name = $2
        ON CONFLICT DO NOTHING
      `, [roleName, perm]);
    }
  };

  // ── 1. super_admin → ALL permissions ─────────────────────────────────────────
  await client.query(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE r.name = 'super_admin'
    ON CONFLICT DO NOTHING
  `);

  // ── 2. admin → manage users, run reports, approve leaves ─────────────────────
  await assignPerms('admin', [
    'users:view', 'users:create', 'users:update', 'users:delete',
    'roles:view', 'roles:assign',
    'attendance:view_all', 'attendance:create', 'attendance:create_others',
    'attendance:update', 'attendance:delete', 'attendance:report',
    'leave:view_all', 'leave:approve', 'leave:view_balance_all', 'leave:manage_balance',
  ]);

  // ── 3. deo → data entry for attendance on behalf of others ───────────────────
  await assignPerms('deo', [
    'users:view',
    'attendance:view_all',
    'attendance:create_others',
    'attendance:update',
    'leave:view_all',
    'reports:view_monthly',
    'reports:approve_deo',
  ]);

  // ── 4. headmaster → oversee school, approve VTs, approve leaves, view reports ──
  await assignPerms('headmaster', [
    'users:view',
    'attendance:view_all',
    'attendance:report',
    'leave:view_all',
    'leave:approve',
    'leave:view_balance_all',
    'vt:approve',
    'reports:generate',
    'reports:view_monthly',
    'reports:approve_hm',
    'attendance:create_others',
  ]);

  // ── 2. admin also gets vt:approve and full report access ─────────────────────
  await assignPerms('admin', [
    'vt:approve',
    'reports:generate',
    'reports:view_monthly',
    'reports:approve_hm',
    'reports:approve_deo',
    'reports:approve_vtp',
  ]);

  // ── 5. vocational_teacher_provider → view & monitor their teachers + VTP approval ──
  await assignPerms('vocational_teacher_provider', [
    'users:view',
    'attendance:view_teachers',
    'attendance:report',
    'leave:view_all',
    'leave:view_balance_all',
    'vt:approve_vtp',
    'reports:view_monthly',
    'reports:approve_vtp',
  ]);

  // ── 6. vocational_teacher → mark own attendance & request leave ───────────────
  await assignPerms('vocational_teacher', [
    'attendance:create',
    'attendance:view_own',
    'leave:request',
    'leave:view_own',
    'leave:view_balance_own',
  ]);
  console.log('✅ Default roles & permissions seeded');
};

module.exports = initDB;
