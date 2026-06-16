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

// Diagnostic Route
app.get('/api/diagnose', async (req, res) => {
  const diagnostics = {
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SMTP_HOST: !!process.env.SMTP_HOST,
      SMTP_PORT: !!process.env.SMTP_PORT,
      SMTP_USER: !!process.env.SMTP_USER,
      SMTP_PASS: !!process.env.SMTP_PASS,
      SMTP_FROM: !!process.env.SMTP_FROM,
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      VERCEL: process.env.VERCEL,
      NODE_ENV: process.env.NODE_ENV
    },
    database: 'untested',
    storage: 'untested',
    email: 'untested',
    canvas: 'untested'
  };

  try {
    const db = require('./db/db');
    await db.initialize();
    const testRow = await db.get('SELECT 1 as test');
    diagnostics.database = testRow && testRow.test === 1 ? 'OK' : 'Failed to query database';
  } catch (err) {
    diagnostics.database = `Error: ${err.message}`;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
      const { data, error } = await supabase.storage.listBuckets();
      if (error) throw error;
      diagnostics.storage = `OK (found ${data.length} buckets)`;
    } else {
      diagnostics.storage = 'Offline (local filesystem)';
    }
  } catch (err) {
    diagnostics.storage = `Error: ${err.message}`;
  }

  try {
    const hasResend = (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith('re_')) || (process.env.SMTP_PASS && process.env.SMTP_PASS.startsWith('re_'));
    diagnostics.email = hasResend ? 'Resend API' : (process.env.SMTP_HOST ? 'SMTP' : 'Offline (JSON Writer)');
  } catch (err) {
    diagnostics.email = `Error: ${err.message}`;
  }

  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillText('Test', 10, 10);
    diagnostics.canvas = 'OK';
  } catch (err) {
    diagnostics.canvas = `Error: ${err.message}`;
  }

  return res.json(diagnostics);
});

// Diagnostic Test Email Route
app.get('/api/test-email', async (req, res) => {
  try {
    const { sendConfirmationEmail } = require('./services/emailService');
    const recipientEmail = req.query.to || process.env.SMTP_USER || 'neversettle689@gmail.com';
    
    const registrant = {
      id: 999,
      name: 'SMTP Test User',
      email: recipientEmail,
      phone: '+919963892454',
      city: 'Hyderabad'
    };

    // Use placeholder card path
    const cardPath = path.join(__dirname, 'card.jpeg');

    console.log(`[Diagnostic] Triggering test email to ${registrant.email}...`);
    const result = await sendConfirmationEmail(registrant, cardPath);
    
    return res.json({
      success: true,
      message: 'Test email sent successfully.',
      provider: (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith('re_')) || (process.env.SMTP_PASS && process.env.SMTP_PASS.startsWith('re_')) ? 'Resend' : (process.env.SMTP_HOST ? 'SMTP' : 'Offline'),
      recipient: recipientEmail,
      result
    });
  } catch (err) {
    console.error('[Diagnostic] Test email failed:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack,
      env_check: {
        SMTP_HOST: !!process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_USER: !!process.env.SMTP_USER,
        SMTP_PASS: !!process.env.SMTP_PASS,
        SMTP_FROM: process.env.SMTP_FROM,
        RESEND_API_KEY: !!process.env.RESEND_API_KEY
      }
    });
  }
});

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
