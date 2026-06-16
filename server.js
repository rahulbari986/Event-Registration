const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./db/db');
const registrationRoutes = require('./routes/registration');
const adminRoutes = require('./routes/admin');
const queue = require('./services/queue');

const app = express();
const PORT = process.env.PORT || 3000;

const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
const uploadDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const cardsDir = isVercel ? '/tmp/generated-cards' : path.join(__dirname, 'generated-cards');
const sentEmailsDir = isVercel ? '/tmp/sent-emails' : path.join(__dirname, 'sent-emails');

// Setup directories locally (if database is SQLite, or for temporary storage)
if (!process.env.DATABASE_URL) {
  [uploadDir, cardsDir, sentEmailsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
}

// Attach DB to request object middleware
app.use(async (req, res, next) => {
  try {
    await db.initialize();
    req.db = db;
    next();
  } catch (err) {
    console.error('Database connection middleware error:', err);
    res.status(500).json({ error: 'Database connection failed.' });
  }
});

// Body parsers & cookie configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'event_2026_cookie_secret'));

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
      await db.initialize();
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
