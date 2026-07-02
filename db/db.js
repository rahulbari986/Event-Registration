const { Pool } = require('pg');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

/**
 * Helper to translate SQLite queries into PostgreSQL compatible queries:
 * 1. Replaces '?' placeholders with '$1', '$2', etc.
 * 2. Appends 'RETURNING id' to INSERT statements if not present.
 * 3. Translates DATE('now') to CURRENT_DATE.
 */
function translateQuery(sql, isPostgres) {
  if (!isPostgres) return sql;

  let index = 1;
  let translated = sql.replace(/\?/g, () => `$${index++}`);

  // Append 'RETURNING id' to INSERT statements for postgres compatibility
  if (/^\s*insert\s+into/i.test(translated) && !/returning/i.test(translated)) {
    translated += ' RETURNING id';
  }

  // Translate SQLite date function to Postgres equivalent
  translated = translated.replace(/DATE\('now'\)/gi, 'CURRENT_DATE');

  return translated;
}

class DatabaseAdapter {
  constructor() {
    this.isPostgres = false;
    this.pool = null;
    this.sqliteDb = null;
    this.initPromise = null;
  }

  async initialize() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const dbUrl = process.env.DATABASE_URL;

      if (dbUrl) {
        console.log('[Database] Connecting to PostgreSQL/Supabase database...');
        this.isPostgres = true;
        this.pool = new Pool({
          connectionString: dbUrl,
          ssl: {
            rejectUnauthorized: false // Required for Supabase
          }
        });

        // Test connection
        const client = await this.pool.connect();
        client.release();
        console.log('[Database] ✓ Connected to PostgreSQL/Supabase database.');

        // Initialize Postgres schema
        await this.initPostgresSchema();
      } else {
        console.log('[Database] No DATABASE_URL found. Using local SQLite database...');
        this.isPostgres = false;
        
        const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
        const dbPath = isVercel ? '/tmp/database.db' : path.join(__dirname, 'database.db');
        
        // Ensure parent directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        this.sqliteDb = await open({
          filename: dbPath,
          driver: sqlite3.Database
        });

        console.log(`[Database] ✓ Connected to SQLite database at: ${dbPath}`);
        
        // Initialize SQLite schema
        await this.initSqliteSchema();
      }
      return this;
    })();

    return this.initPromise;
  }

  async initPostgresSchema() {
    console.log('[Database] Initializing PostgreSQL schema...');
    
    // Enable uuid if needed, though SERIAL is fine
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        city VARCHAR(100) NOT NULL,
        photo_path TEXT,
        card_path TEXT,
        card_status VARCHAR(50) DEFAULT 'pending',
        email_status VARCHAR(50) DEFAULT 'pending',
        attendance VARCHAR(100),
        designation VARCHAR(255),
        organisation VARCHAR(255),
        about_company TEXT,
        event_objective TEXT,
        interested_in TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Run PostgreSQL migrations for existing tables
    const pgMigrations = [
      "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS attendance VARCHAR(100)",
      "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS designation VARCHAR(255)",
      "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS organisation VARCHAR(255)",
      "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS about_company TEXT",
      "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS event_objective TEXT",
      "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS interested_in TEXT"
    ];
    for (const migration of pgMigrations) {
      try {
        await this.pool.query(migration);
      } catch (err) {
        console.warn(`[Database] Postgres migration warning for "${migration}":`, err.message);
      }
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        registration_id INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'queued',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
      )
    `);

    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email)');
    
    console.log('[Database] ✓ PostgreSQL tables and indexes ensured.');
  }

  async initSqliteSchema() {
    console.log('[Database] Initializing SQLite schema...');
    await this.sqliteDb.run('PRAGMA foreign_keys = ON');

    await this.sqliteDb.exec(`
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
        attendance TEXT,
        designation TEXT,
        organisation TEXT,
        about_company TEXT,
        event_objective TEXT,
        interested_in TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure migration for photo_path and other new columns exists locally
    const sqliteMigrations = [
      'ALTER TABLE registrations ADD COLUMN photo_path TEXT',
      'ALTER TABLE registrations ADD COLUMN attendance TEXT',
      'ALTER TABLE registrations ADD COLUMN designation TEXT',
      'ALTER TABLE registrations ADD COLUMN organisation TEXT',
      'ALTER TABLE registrations ADD COLUMN about_company TEXT',
      'ALTER TABLE registrations ADD COLUMN event_objective TEXT',
      'ALTER TABLE registrations ADD COLUMN interested_in TEXT'
    ];

    for (const migration of sqliteMigrations) {
      try {
        await this.sqliteDb.run(migration);
        console.log(`[Database] SQLite Migration: executed "${migration}".`);
      } catch (e) {
        if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
          throw e;
        }
      }
    }

    await this.sqliteDb.exec(`
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

    await this.sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);
    `);

    console.log('[Database] ✓ SQLite tables and indexes ensured.');
  }

  async get(sql, params = []) {
    await this.initialize();
    const translated = translateQuery(sql, this.isPostgres);
    
    if (this.isPostgres) {
      const res = await this.pool.query(translated, params);
      return res.rows[0] || null;
    } else {
      return await this.sqliteDb.get(sql, params);
    }
  }

  async all(sql, params = []) {
    await this.initialize();
    const translated = translateQuery(sql, this.isPostgres);
    
    if (this.isPostgres) {
      const res = await this.pool.query(translated, params);
      return res.rows || [];
    } else {
      return await this.sqliteDb.all(sql, params);
    }
  }

  async run(sql, params = []) {
    await this.initialize();
    const translated = translateQuery(sql, this.isPostgres);
    
    if (this.isPostgres) {
      const res = await this.pool.query(translated, params);
      const lastID = res.rows && res.rows[0] ? res.rows[0].id : null;
      return { lastID, changes: res.rowCount };
    } else {
      const result = await this.sqliteDb.run(sql, params);
      return { lastID: result.lastID, changes: result.changes };
    }
  }

  async close() {
    if (this.isPostgres && this.pool) {
      await this.pool.end();
      console.log('[Database] PostgreSQL pool connection ended.');
    } else if (this.sqliteDb) {
      await this.sqliteDb.close();
      console.log('[Database] SQLite database connection closed.');
    }
    this.initPromise = null;
  }
}

// Single instance shared across requests
const dbInstance = new DatabaseAdapter();

module.exports = dbInstance;
