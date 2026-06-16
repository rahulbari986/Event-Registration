require('dotenv').config();
const db = require('./db');

async function initializeDatabase() {
  console.log('[Init-DB] Starting database initialization...');
  await db.initialize();
  console.log('[Init-DB] ✓ Database schema is up to date.');
  await db.close();
  console.log('[Init-DB] Database connection closed.');
}

if (require.main === module) {
  initializeDatabase().catch(err => {
    console.error('[Init-DB] Failed to initialize database:', err);
    process.exit(1);
  });
}

module.exports = initializeDatabase;
