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
                          CHECK (status IN ('present','absent','late','half_day','on_leave')),
        latitude        NUMERIC(10, 8),
        longitude       NUMERIC(11, 8),
        photo_path      TEXT,
        remarks         TEXT,
        marked_by       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, date)
      );
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
                       CHECK (leave_type IN ('full-day','first-half','second-half')),
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

    await client.query('COMMIT');
    console.log('✅ All tables created/verified successfully');

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
      description: 'Data Entry Operator — enter and update attendance data on behalf of teachers',
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
    'leave:view_all', 'leave:approve',
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
  ]);

  console.log('✅ Default roles & permissions seeded');
};

module.exports = initDB;
