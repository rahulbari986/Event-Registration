const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

async function initializeDatabase(customDbPath) {
  const dbPath = customDbPath || path.join(__dirname, 'database.db');

  console.log(`Initializing database at: ${dbPath}`);
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Create registrations table (non-destructive)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT NOT NULL,
      photo_path TEXT,
      card_path TEXT,
      card_status TEXT DEFAULT 'pending',
      email_status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('Ensured table: registrations');

  // Add photo_path column if it does not exist (migration for existing DBs)
  try {
    await db.run('ALTER TABLE registrations ADD COLUMN photo_path TEXT');
    console.log('Migration: added photo_path column to registrations.');
  } catch (e) {
    // Column already exists — ignore duplicate column error
    if (!e.message.includes('duplicate column name')) {
      throw e;
    }
  }

  // Create jobs table (non-destructive)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      status TEXT DEFAULT 'queued',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,
      FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
    )
  `);
  console.log('Ensured table: jobs');

  // Add indexes
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);
  `);
  console.log('Database indexes ensured.');

  await db.close();
  console.log('Database initialization complete.');
}

if (require.main === module) {
  initializeDatabase().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
}

module.exports = initializeDatabase;
