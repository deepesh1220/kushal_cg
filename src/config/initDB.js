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
        remarks       TEXT
      );
    `);

    // Ensure profile-extension columns exist on vt_staff_details
    await client.query(`
      ALTER TABLE vt_staff_details
        ADD COLUMN IF NOT EXISTS dob                      DATE,
        ADD COLUMN IF NOT EXISTS educational_qualification VARCHAR(200),
        ADD COLUMN IF NOT EXISTS date_of_joining          DATE;
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
        is_active          BOOLEAN      DEFAULT TRUE,
        profile_photo      TEXT,
        created_at         TIMESTAMPTZ  DEFAULT NOW(),
        updated_at         TIMESTAMPTZ  DEFAULT NOW()
      );
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
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS checkout_latitude NUMERIC(10, 8);
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS checkout_longitude NUMERIC(11, 8);
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
        total_earned      DECIMAL(5,2) DEFAULT 0.00,    -- Total EL credited this year (capped 18)
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
    // Audit log for monthly 1.5 EL credit cron job
    // ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_leave_credit_log (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        year           INTEGER NOT NULL,
        month          INTEGER NOT NULL,  -- 1-12
        credited_leave DECIMAL(3,1) DEFAULT 1.5,
        credited_at    TIMESTAMPTZ DEFAULT NOW(),
        status         VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'failed', 'skipped')),
        error_message  TEXT,
        UNIQUE (user_id, year, month)
      );
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
        UNIQUE (udise_code, report_month, report_year)
      );
    `);

    // ─────────────────────────────────────────────────────────
    // ALTER CONSTRAINTS for OD feature
    // ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
      ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_leave_type_check CHECK (leave_type IN ('full-day','first-half','second-half','od','regularization'));

      ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
      ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_status_check CHECK (status IN ('present','absent','late','half_day','on_leave','od'));
    `);

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
      description: 'Manage users, attendance records, reports, and approve leaves',
    },
    {
      name: 'deo',
      description: 'District Education Officer — enter and update attendance data on behalf of teachers',
    },
    {
      name: 'headmaster',
      description: 'School head — view all attendance, approve leaves, access reports',
    },
    {
      name: 'vocational_teacher_provider',
      description: 'Provider organisation — view and manage their assigned vocational teachers',
    },
    {
      name: 'vocational_teacher',
      description: 'Vocational teacher — mark own attendance and submit leave requests',
    },
    {
      name: 'programmer',
      description: 'Programmer — enter and update attendance data on behalf of headmaster and teachers',
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
    { name: 'attendance:view_own', module: 'attendance', action: 'view_own', description: 'View own attendance records only' },
    { name: 'attendance:view_all', module: 'attendance', action: 'view_all', description: 'View attendance records of all users' },
    { name: 'attendance:view_teachers', module: 'attendance', action: 'view_teachers', description: 'View attendance of assigned vocational teachers' },
    { name: 'attendance:create', module: 'attendance', action: 'create', description: 'Mark own attendance' },
    { name: 'attendance:create_others', module: 'attendance', action: 'create_others', description: 'Mark attendance on behalf of others (DEO)' },
    { name: 'attendance:update', module: 'attendance', action: 'update', description: 'Edit/correct attendance records' },
    { name: 'attendance:delete', module: 'attendance', action: 'delete', description: 'Delete attendance records' },
    { name: 'attendance:report', module: 'attendance', action: 'report', description: 'Generate and view attendance reports' },
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
    { name: 'vt:approve', module: 'vt', action: 'approve', description: 'Approve or reject Vocational Teacher registrations' },
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
  ]);

  // ── 2. admin also gets vt:approve ────────────────────────────────────────────
  await assignPerms('admin', ['vt:approve']);

  // ── 5. vocational_teacher_provider → view & monitor their teachers ────────────
  await assignPerms('vocational_teacher_provider', [
    'users:view',
    'attendance:view_teachers',
    'attendance:report',
    'leave:view_all',
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
