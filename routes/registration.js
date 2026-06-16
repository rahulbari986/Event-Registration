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
    const name  = (req.body.name  || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();
    const city  = (req.body.city  || '').trim();

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
        (name, email, phone, city, photo_path, card_status, email_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, email, phone, city, photoPath]
    );

    const registrationId = result.lastID;

    // ── Enqueue background job ─────────────────────────────────────────────
    await queue.enqueueJob(req.db, registrationId);

    // If running in Vercel (serverless environment), process it synchronously
    if (isVercel) {
      await queue.processSynchronously(req.db, registrationId);
    }

    // Attempt to read the generated card to send back as base64 for instant render
    let cardDataUrl = null;
    let regDetails = null;

    try {
      const updatedReg = await req.db.get(
        `SELECT id, name, email, phone, city, photo_path, card_path,
                card_status, email_status, created_at
         FROM registrations WHERE id = ?`,
        [registrationId]
      );
      if (updatedReg) {
        regDetails = updatedReg;
        if (updatedReg.card_status === 'generated' && updatedReg.card_path) {
          const cardsDir = isVercel ? '/tmp/generated-cards' : path.join(process.cwd(), 'generated-cards');
          const cardFilename = path.basename(updatedReg.card_path);
          const cardFullPath = path.join(cardsDir, cardFilename);
          
          if (fs.existsSync(cardFullPath)) {
            const buffer = fs.readFileSync(cardFullPath);
            cardDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
          }
        }
      }
    } catch (e) {
      console.error('Failed to attach card data to response:', e);
    }

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Card generation enqueued.',
      id: registrationId,
      registration: regDetails,
      cardDataUrl: cardDataUrl
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
              card_status, email_status, created_at
       FROM registrations WHERE id = ?`,
      [req.params.id]
    );
    if (!registrant) {
      return res.status(404).json({ error: 'Registration not found.' });
    }
    return res.json(registrant);
  } catch (err) {
    console.error('Error fetching registration:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
