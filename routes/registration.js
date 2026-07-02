const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const queue = require('../services/queue');
const storageManager = require('../services/storage');

const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;

// ── Multer storage ──────────────────────────────────────────────────────────
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, or WEBP images are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

// ── Strict validation rules ─────────────────────────────────────────────────
// Name: letters, spaces, hyphens, apostrophes only — no numbers or symbols
const NAME_REGEX  = /^[A-Za-z\s'\-]+$/;
// Phone: exactly +91 followed by exactly 10 digits (no spaces/dashes allowed)
const PHONE_REGEX = /^\+91[0-9]{10}$/;
// Email: standard validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/registration
 */
router.post('/registration', upload.single('photo'), async (req, res) => {
  try {
    const name            = (req.body.name            || '').trim();
    const email           = (req.body.email           || '').trim().toLowerCase();
    const phone           = (req.body.phone           || '').trim();
    const city            = (req.body.city            || '').trim();
    const attendance      = (req.body.attendance      || '').trim();
    const designation     = (req.body.designation     || '').trim();
    const organisation     = (req.body.organisation     || '').trim();
    const about_company   = (req.body.about_company   || '').trim();
    const event_objective = (req.body.event_objective || '').trim();

    let interestedIn = req.body.interested_in;
    if (Array.isArray(interestedIn)) {
      interestedIn = interestedIn.join(', ');
    } else {
      interestedIn = (interestedIn || '').trim();
    }

    // ── Name ──────────────────────────────────────────────────────────────
    if (!name) {
      return res.status(400).json({ error: 'Full Name is required.' });
    }
    if (name.length < 2) {
      return res.status(400).json({ error: 'Full Name must be at least 2 characters.' });
    }
    if (!NAME_REGEX.test(name)) {
      return res.status(400).json({ error: 'Full Name must contain letters only (no numbers or special characters).' });
    }

    // ── Email ──────────────────────────────────────────────────────────────
    if (!email) {
      return res.status(400).json({ error: 'Email Address is required.' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // ── Phone (strict: +91 + 10 digits) ────────────────────────────────────
    if (!phone) {
      return res.status(400).json({ error: 'Phone Number is required.' });
    }
    if (!PHONE_REGEX.test(phone)) {
      return res.status(400).json({ error: 'Phone must be in format +91XXXXXXXXXX (exactly 10 digits after +91).' });
    }

    // ── City ───────────────────────────────────────────────────────────────
    if (!city) {
      return res.status(400).json({ error: 'City is required.' });
    }
    if (city.length < 2) {
      return res.status(400).json({ error: 'City must be at least 2 characters.' });
    }

    // ── Attendance ────────────────────────────────────────────────────────
    if (!attendance) {
      return res.status(400).json({ error: 'Please specify if you can attend.' });
    }

    // ── Designation ───────────────────────────────────────────────────────
    if (!designation) {
      return res.status(400).json({ error: 'Designation is required.' });
    }
    if (designation.length < 2) {
      return res.status(400).json({ error: 'Designation must be at least 2 characters.' });
    }

    // ── Organisation ───────────────────────────────────────────────────────
    if (!organisation) {
      return res.status(400).json({ error: 'Organisation is required.' });
    }
    if (organisation.length < 2) {
      return res.status(400).json({ error: 'Organisation must be at least 2 characters.' });
    }

    // ── About Company ─────────────────────────────────────────────────────
    if (!about_company) {
      return res.status(400).json({ error: 'About the company description is required.' });
    }
    if (about_company.length < 10) {
      return res.status(400).json({ error: 'About the company must be at least 10 characters.' });
    }

    // ── Event Objective ───────────────────────────────────────────────────
    if (!event_objective) {
      return res.status(400).json({ error: 'Event objective is required.' });
    }
    if (event_objective.length < 10) {
      return res.status(400).json({ error: 'Event objective must be at least 10 characters.' });
    }

    // ── Interested In ─────────────────────────────────────────────────────
    if (!interestedIn) {
      return res.status(400).json({ error: 'Please select what you are interested in.' });
    }

    // ── Duplicate check ────────────────────────────────────────────────────
    const existing = await req.db.get(
      'SELECT id FROM registrations WHERE email = ?',
      [email]
    );
    if (existing) {
      return res.status(400).json({ error: 'This email address is already registered.' });
    }

    // ── Photo path ─────────────────────────────────────────────────────────
    let photoPath = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const uniqueFilename = `photo_${Date.now()}${ext}`;
      photoPath = await storageManager.uploadPhoto(req.file.buffer, uniqueFilename, req.file.mimetype);
    }

    // ── Insert ─────────────────────────────────────────────────────────────
    const result = await req.db.run(
      `INSERT INTO registrations
        (name, email, phone, city, photo_path, attendance, designation, organisation, about_company, event_objective, interested_in, card_status, email_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, email, phone, city, photoPath, attendance, designation, organisation, about_company, event_objective, interestedIn]
    );

    const registrationId = result.lastID;

    // ── Enqueue background job ─────────────────────────────────────────────
    await queue.enqueueJob(req.db, registrationId);

    const regDetails = await req.db.get(
      `SELECT id, name, email, phone, city, photo_path, card_path,
              card_status, email_status, attendance, designation, organisation, about_company, event_objective, interested_in, created_at
       FROM registrations WHERE id = ?`,
      [registrationId]
    );

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Card generation enqueued.',
      id: registrationId,
      registration: regDetails,
      cardDataUrl: null
    });

  } catch (err) {
    console.error('Registration API Error:', err);
    return res.status(500).json({ error: 'Failed to process registration. Please try again.' });
  }
});

/**
 * GET /api/registration/:id
 * Polling route for Success page
 */
router.get('/registration/:id', async (req, res) => {
  try {
    const registrant = await req.db.get(
      `SELECT id, name, email, phone, city, photo_path, card_path,
              card_status, email_status, attendance, designation, organisation, about_company, event_objective, interested_in, created_at
       FROM registrations WHERE id = ?`,
      [req.params.id]
    );
    if (!registrant) {
      return res.status(404).json({ error: 'Registration not found.' });
    }

    // On-demand card generation if pending (suitable for serverless environments)
    if (registrant.card_status === 'pending') {
      console.log(`[On-Demand Processor] Initiating card generation for registrant ${registrant.id}...`);
      
      // Update status to processing immediately to act as a concurrency lock
      await req.db.run(
        "UPDATE registrations SET card_status = 'processing', email_status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [registrant.id]
      );

      // Generate card and update DB synchronously
      await queue.processSynchronously(req.db, registrant.id);

      // Re-fetch updated registrant record
      const updatedRegistrant = await req.db.get(
        `SELECT id, name, email, phone, city, photo_path, card_path,
                card_status, email_status, attendance, designation, organisation, about_company, event_objective, interested_in, created_at
         FROM registrations WHERE id = ?`,
        [registrant.id]
      );
      return res.json(updatedRegistrant);
    }

    return res.json(registrant);
  } catch (err) {
    console.error('Error fetching registration:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
