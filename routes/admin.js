const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const queue = require('../services/queue');

const JWT_SECRET = process.env.JWT_SECRET || 'event_2026_jwt_secret_key';
const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;

// Auth Middleware
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.admin_token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in.' });
  }
}

/**
 * POST /api/admin/login
 */
router.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || 'akhil';

  if (password === adminPass) {
    const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '24h' });
    
    // Set HTTP-Only, Secure cookie
    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    return res.json({ success: true, message: 'Logged in successfully.' });
  }

  return res.status(401).json({ error: 'Invalid password.' });
});

/**
 * POST /api/admin/logout
 */
router.post('/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  return res.json({ success: true, message: 'Logged out successfully.' });
});

/**
 * GET /api/admin/check-auth
 */
router.get('/admin/check-auth', (req, res) => {
  const token = req.cookies && req.cookies.admin_token;
  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    jwt.verify(token, JWT_SECRET);
    return res.json({ authenticated: true });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

/**
 * GET /api/admin/stats
 * Dashboard aggregation metrics
 */
router.get('/admin/stats', requireAuth, async (req, res) => {
  try {
    const totalReg   = await req.db.get('SELECT COUNT(*) AS total FROM registrations');
    const cardsGen   = await req.db.get("SELECT COUNT(*) AS total FROM registrations WHERE card_status = 'generated'");
    const emailsSent = await req.db.get("SELECT COUNT(*) AS total FROM registrations WHERE email_status = 'sent'");
    const pendingJobs = await req.db.get("SELECT COUNT(*) AS total FROM jobs WHERE status IN ('queued', 'processing')");

    return res.json({
      totalRegistrations: totalReg.total,
      cardsGenerated: cardsGen.total,
      emailsSent: emailsSent.total,
      pendingJobs: pendingJobs.total
    });
  } catch (err) {
    console.error('Stats fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch metrics.' });
  }
});

/**
 * GET /api/admin/queue-stats
 * Detailed queue monitoring widget data
 */
router.get('/admin/queue-stats', requireAuth, async (req, res) => {
  try {
    const pending    = await req.db.get("SELECT COUNT(*) AS total FROM jobs WHERE status = 'queued'");
    const processing = await req.db.get("SELECT COUNT(*) AS total FROM jobs WHERE status = 'processing'");
    const failed     = await req.db.get("SELECT COUNT(*) AS total FROM jobs WHERE status = 'failed'");

    // Completed today
    const completedToday = await req.db.get(
      "SELECT COUNT(*) AS total FROM jobs WHERE status = 'completed' AND DATE(processed_at) = DATE('now')"
    );

    return res.json({
      pending: pending.total,
      processing: processing.total,
      failed: failed.total,
      completedToday: completedToday.total
    });
  } catch (err) {
    console.error('Queue stats error:', err);
    return res.status(500).json({ error: 'Failed to fetch queue stats.' });
  }
});

/**
 * GET /api/admin/registrations
 * Supports ?search=, ?status=pending|generated|failed|processing
 */
router.get('/admin/registrations', requireAuth, async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const status = req.query.status || null;

    let conditions = [];
    let params = [];

    if (search) {
      conditions.push('(name LIKE ? OR email LIKE ? OR city LIKE ?)');
      params.push(search, search, search);
    }

    if (status && status !== 'all') {
      // Map UI filter to actual DB columns
      if (status === 'pending') {
        conditions.push("card_status = 'pending'");
      } else if (status === 'completed') {
        conditions.push("card_status = 'generated' AND email_status = 'sent'");
      } else if (status === 'failed') {
        conditions.push("(card_status = 'failed' OR email_status = 'failed')");
      } else if (status === 'processing') {
        conditions.push("(card_status = 'processing' OR email_status = 'processing')");
      }
    }

    let query = 'SELECT * FROM registrations';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const rows = await req.db.all(query, params);

    return res.json({
      registrations: rows,
      total: rows.length
    });
  } catch (err) {
    console.error('Registrations fetch error:', err);
    return res.status(500).json({ error: 'Failed to retrieve registrations.' });
  }
});

/**
 * GET /api/admin/registrations/:id
 */
router.get('/admin/registrations/:id', requireAuth, async (req, res) => {
  try {
    const registrant = await req.db.get('SELECT * FROM registrations WHERE id = ?', [req.params.id]);
    if (!registrant) {
      return res.status(404).json({ error: 'Registrant not found.' });
    }
    return res.json(registrant);
  } catch (err) {
    console.error('Registrant detail error:', err);
    return res.status(500).json({ error: 'Failed to retrieve details.' });
  }
});

/**
 * PUT /api/admin/registrations/:id  (FIXED: was /api/admin/... causing double prefix)
 */
router.put('/admin/registrations/:id', requireAuth, async (req, res) => {
  try {
    const registrantId = req.params.id;
    const { name, email, phone, city, card_status, email_status } = req.body;

    const current = await req.db.get('SELECT * FROM registrations WHERE id = ?', [registrantId]);
    if (!current) {
      return res.status(404).json({ error: 'Registrant not found.' });
    }

    // Validation
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Full Name must be at least 2 characters.' });
    }
    const nameRegex = /^[A-Za-z\s'\-]+$/;
    if (!nameRegex.test(name.trim())) {
      return res.status(400).json({ error: 'Full Name must contain letters only (no numbers or special characters).' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email Address is required.' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim().toLowerCase())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: 'Phone Number is required.' });
    }
    const phoneRegex = /^\+91[0-9]{10}$/;
    if (!phoneRegex.test(phone.trim())) {
      return res.status(400).json({ error: 'Phone must be in format +91XXXXXXXXXX (exactly 10 digits after +91).' });
    }
    if (!city || city.trim().length < 2) {
      return res.status(400).json({ error: 'City must be at least 2 characters.' });
    }

    await req.db.run(
      `UPDATE registrations 
       SET name = ?, email = ?, phone = ?, city = ?, 
           card_status = ?, email_status = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [
        name.trim(),
        email.trim(),
        phone.trim(),
        city.trim(),
        card_status || current.card_status,
        email_status || current.email_status,
        registrantId
      ]
    );

    // Auto queue card regeneration
    await queue.enqueueJob(req.db, registrantId);

    if (isVercel) {
      await queue.processSynchronously(req.db, registrantId);
    }

    return res.json({ success: true, message: 'Details updated. Card regeneration enqueued.' });
  } catch (err) {
    console.error('Admin update error:', err);
    return res.status(500).json({ error: 'Failed to update attendee details.' });
  }
});

/**
 * DELETE /api/admin/registrations/:id  (FIXED: was double-prefixed)
 */
router.delete('/admin/registrations/:id', requireAuth, async (req, res) => {
  try {
    const registrantId = req.params.id;
    const registrant = await req.db.get('SELECT card_path, photo_path FROM registrations WHERE id = ?', [registrantId]);
    if (!registrant) {
      return res.status(404).json({ error: 'Registrant not found.' });
    }

    // Delete generated card PNG
    if (registrant.card_path) {
      const cardPath = path.join(process.cwd(), registrant.card_path);
      if (fs.existsSync(cardPath)) {
        fs.unlinkSync(cardPath);
      }
    }

    // Delete uploaded photo
    if (registrant.photo_path) {
      const photoPath = path.join(process.cwd(), registrant.photo_path);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    await req.db.run('DELETE FROM registrations WHERE id = ?', [registrantId]);
    return res.json({ success: true, message: 'Registrant and associated files deleted.' });
  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ error: 'Failed to delete record.' });
  }
});

/**
 * POST /api/admin/regenerate-card/:id  (FIXED: was double-prefixed)
 */
router.post('/admin/regenerate-card/:id', requireAuth, async (req, res) => {
  try {
    const registrantId = req.params.id;
    const exists = await req.db.get('SELECT id FROM registrations WHERE id = ?', [registrantId]);
    if (!exists) {
      return res.status(404).json({ error: 'Registrant not found.' });
    }

    await req.db.run("UPDATE registrations SET card_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [registrantId]);
    await queue.enqueueJob(req.db, registrantId);

    if (isVercel) {
      await queue.processSynchronously(req.db, registrantId);
    }

    return res.json({ success: true, message: 'Card regeneration queued.' });
  } catch (err) {
    console.error('Regenerate error:', err);
    return res.status(500).json({ error: 'Failed to trigger regeneration.' });
  }
});

/**
 * POST /api/admin/resend-email/:id  (FIXED: was double-prefixed)
 */
router.post('/admin/resend-email/:id', requireAuth, async (req, res) => {
  try {
    const registrantId = req.params.id;
    const exists = await req.db.get('SELECT id FROM registrations WHERE id = ?', [registrantId]);
    if (!exists) {
      return res.status(404).json({ error: 'Registrant not found.' });
    }

    await req.db.run("UPDATE registrations SET email_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [registrantId]);
    await queue.enqueueJob(req.db, registrantId);

    if (isVercel) {
      await queue.processSynchronously(req.db, registrantId);
    }

    return res.json({ success: true, message: 'Email dispatch queued.' });
  } catch (err) {
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Failed to trigger email dispatch.' });
  }
});

module.exports = router;
