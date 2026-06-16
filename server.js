const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
require('dotenv').config();

const registrationRoutes = require('./routes/registration');
const adminRoutes = require('./routes/admin');
const queue = require('./services/queue');
const initDb = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
const uploadDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const cardsDir = isVercel ? '/tmp/generated-cards' : path.join(__dirname, 'generated-cards');
const sentEmailsDir = isVercel ? '/tmp/sent-emails' : path.join(__dirname, 'sent-emails');
const dbPath = isVercel ? '/tmp/database.db' : path.join(__dirname, 'db', 'database.db');

// Setup directories
[uploadDir, cardsDir, sentEmailsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Lazy DB initialization
let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      console.log(`Connecting to SQLite database at: ${dbPath}`);
      const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });
      // Run schema tables setup
      await initDb(dbPath);
      return db;
    })();
  }
  return dbPromise;
}

// Attach DB to request object middleware
app.use(async (req, res, next) => {
  try {
    req.db = await getDb();
    next();
  } catch (err) {
    console.error('Database connection middleware error:', err);
    res.status(500).json({ error: 'Database connection failed.' });
  }
});

// Body parsers & session configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'event_2026_default_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true if running on HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// API Routes
app.use('/api', registrationRoutes);
app.use('/api', adminRoutes);

// Static Files Serving
// Serve uploads and generated cards
app.use('/uploads', express.static(uploadDir));
app.use('/generated-cards', express.static(cardsDir));
// Serve public files statically
app.use(express.static(path.join(__dirname, 'public')));

// Vanity Routes (clean URLs without .html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Boot operations (Only run on non-Vercel environments)
if (!isVercel) {
  (async () => {
    try {
      const db = await getDb();
      // Start Background Queue Worker
      queue.startWorker(db, 3000);

      // Start Listener
      const server = app.listen(PORT, () => {
        console.log(`===================================================`);
        console.log(`EVENT 2026 Registration Portal running at:`);
        console.log(`👉 http://localhost:${PORT}`);
        console.log(`👉 Admin Panel: http://localhost:${PORT}/admin`);
        console.log(`===================================================`);
      });

      // Handle Graceful Shutdown
      process.on('SIGTERM', () => {
        console.log('SIGTERM signal received: closing HTTP server');
        queue.stopWorker();
        server.close(async () => {
          console.log('HTTP server closed. Closing database connection...');
          await db.close();
          process.exit(0);
        });
      });

      process.on('SIGINT', () => {
        console.log('SIGINT signal received: closing HTTP server');
        queue.stopWorker();
        server.close(async () => {
          console.log('HTTP server closed. Closing database connection...');
          await db.close();
          process.exit(0);
        });
      });
    } catch (err) {
      console.error('Critical Local Server Boot Error:', err);
      process.exit(1);
    }
  })();
}

module.exports = app;
