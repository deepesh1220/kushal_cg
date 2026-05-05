const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config();

const { createDatabaseIfNotExists } = require('./config/db');
const initDB = require('./config/initDB');
const { initLeaveCreditCronJob } = require('./jobs/leaveCreditJob');
const { initYearEndCarryForwardCronJob } = require('./jobs/yearEndCarryForwardJob');

// ─── Routes ───────────────────────────────────────────────────────────────────
const apiRoutes = require('./routes/routes.js');

const app = express();

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static('src/uploads'));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'API is running 🚀' });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: `Route ${req.originalUrl} not found.` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(500).json({ status: 'error', message: err.message || 'Internal Server Error' });
});

// ─── Bootstrap: Create DB → Init Tables → Start Server ───────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await createDatabaseIfNotExists(); // Step 1: Ensure DB exists
    await initDB();                    // Step 2: Create tables + seed roles/permissions
    app.listen(PORT, () => {
      console.log(`\n🚀 Server running on http://localhost:${PORT}`);
      console.log(`📋 Health check: http://localhost:${PORT}/api/health\n`);

      // Initialize leave credit & year-end cron jobs
      initLeaveCreditCronJob();
      initYearEndCarryForwardCronJob();
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
