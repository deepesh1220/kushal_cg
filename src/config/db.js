const { Pool, Client, types } = require('pg');
require('dotenv').config();

// Override pg's default parsing for DATE (OID 1082) columns to return raw string instead of a JavaScript Date object
// This prevents timezone shift issues where '2026-04-23' turns into '2026-04-22T18:30:00.000Z'
types.setTypeParser(1082, (val) => val);

// ─── Step 1: Connect to default 'postgres' DB to create app DB if needed ───────
const createDatabaseIfNotExists = async () => {
  const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: 'postgres', // connect to default DB first
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });

  try {
    await client.connect();
    const dbName = process.env.DB_NAME;

    const result = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database "${dbName}" created successfully`);
    } else {
      console.log(`✅ Database "${dbName}" already exists`);
    }
  } catch (error) {
    console.error('❌ Error creating database:', error.message);
    throw error;
  } finally {
    await client.end();
  }
};

// ─── Step 2: Pool connected to the actual app database ──────────────────────────
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 20,                // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  // silent success, initDB will log details
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client:', err.message);
  process.exit(-1);
});

module.exports = { pool, createDatabaseIfNotExists };
