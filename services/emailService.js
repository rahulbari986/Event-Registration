const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

let transporter = null;

// ── Build transporter (called once, cached) ─────────────────────────────────
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Offline fallback — saves emails to disk for development
    console.warn('[Email] SMTP not configured — using offline JSON transport. Emails will NOT be sent.');
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,   // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user, pass },
    tls: {
      rejectUnauthorized: true  // enforce valid certs for Gmail
    },
    pool: true,              // keep connection alive for multiple sends
    maxConnections: 3,
    rateDelta: 1000,
    rateLimit: 3             // max 3 emails per second
  });

  console.log(`[Email] SMTP configured → ${host}:${port} as ${user}`);
  return transporter;
}

// ── Verify connection on startup ─────────────────────────────────────────────
async function verifyConnection() {
  const t = getTransporter();
  if (t.options && t.options.jsonTransport) return; // skip for offline
  try {
    await t.verify();
    console.log('[Email] ✓ SMTP connection verified successfully.');
  } catch (err) {
    console.error('[Email] ✗ SMTP connection failed:', err.message);
  }
}
verifyConnection();

// ── Main send function ───────────────────────────────────────────────────────
/**
 * Sends a registration confirmation email with the attendee card attached.
 * Structured to maximise inbox delivery (avoid spam filters):
 *   - Multipart/alternative: plain-text + HTML
 *   - Clean subject (no trigger words)
 *   - Proper Reply-To, proper From display name
 *   - Inline card image + attachment
 *
 * @param {Object} registrant  - DB row
 * @param {string} cardPath    - Absolute path to the generated card PNG
 */
async function sendConfirmationEmail(registrant, cardPath) {
  const client = getTransporter();
  const from   = process.env.SMTP_FROM || `Event 2026 <${process.env.SMTP_USER}>`;

  const refId  = `EVT-2026-${String(registrant.id).padStart(5, '0')}`;
  const name   = registrant.name   || 'Attendee';
  const email  = registrant.email;
  const phone  = registrant.phone  || '—';
  const city   = registrant.city   || '—';

  // ── Plain text version (critical for inbox delivery) ────────────────────
  const plainText = `
Hello ${name},

Your registration for EVENT 2026 — Future of Innovation has been confirmed.

REGISTRATION DETAILS
---------------------
Reference ID : ${refId}
Name         : ${name}
Email        : ${email}
Phone        : ${phone}
City         : ${city}

Your attendee card is attached to this email as a PNG image.
Please save it and bring it (digitally or printed) to the event.

EVENT 2026
Date    : August 2026
Venue   : Hyderabad, India

We look forward to welcoming you.

— EVENT 2026 Organizing Committee
`.trim();

  // ── HTML version ─────────────────────────────────────────────────────────
  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>EVENT 2026 — Registration Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">

      <!-- Card -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="600"
        style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;
               box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header bar -->
        <tr>
          <td style="background:linear-gradient(135deg,#071428 0%,#0d1f3c 100%);
                     padding:32px 40px;text-align:center;">
            <div style="font-size:26px;font-weight:700;color:#D4AF37;
                        font-family:Georgia,serif;letter-spacing:0.06em;">
              EVENT 2026
            </div>
            <div style="font-size:12px;color:rgba(212,175,55,0.7);
                        letter-spacing:0.16em;text-transform:uppercase;margin-top:6px;">
              Future of Innovation
            </div>
          </td>
        </tr>

        <!-- Gold rule -->
        <tr>
          <td style="height:3px;background:linear-gradient(90deg,#AA7C11,#F2CA50,#AA7C11);"></td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">

            <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#071428;">
              Hello ${name},
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
              Your registration for <strong>EVENT 2026</strong> has been confirmed!
              Your attendee card is attached below — please bring it to the event.
            </p>

            <!-- Reference ID box -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
              style="background:#f9f6ee;border:1px solid #e8d89c;border-radius:8px;
                     margin-bottom:28px;">
              <tr>
                <td style="padding:16px 20px;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:0.18em;
                              text-transform:uppercase;color:#AA7C11;margin-bottom:4px;">
                    Reference ID
                  </div>
                  <div style="font-size:22px;font-weight:700;color:#071428;
                              font-family:Georgia,serif;letter-spacing:0.06em;">
                    ${refId}
                  </div>
                </td>
              </tr>
            </table>

            <!-- Details grid -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
              style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
              <tr style="background:#f9fafb;">
                <td style="padding:12px 16px;font-size:11px;font-weight:700;
                           letter-spacing:0.12em;text-transform:uppercase;
                           color:#888;width:35%;border-bottom:1px solid #e5e7eb;">Name</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;
                           color:#111;border-bottom:1px solid #e5e7eb;">${name}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-size:11px;font-weight:700;
                           letter-spacing:0.12em;text-transform:uppercase;
                           color:#888;border-bottom:1px solid #e5e7eb;">Email</td>
                <td style="padding:12px 16px;font-size:14px;color:#111;
                           border-bottom:1px solid #e5e7eb;">${email}</td>
              </tr>
              <tr style="background:#f9fafb;">
                <td style="padding:12px 16px;font-size:11px;font-weight:700;
                           letter-spacing:0.12em;text-transform:uppercase;
                           color:#888;border-bottom:1px solid #e5e7eb;">Phone</td>
                <td style="padding:12px 16px;font-size:14px;color:#111;
                           border-bottom:1px solid #e5e7eb;">${phone}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-size:11px;font-weight:700;
                           letter-spacing:0.12em;text-transform:uppercase;color:#888;">City</td>
                <td style="padding:12px 16px;font-size:14px;color:#111;">${city}</td>
              </tr>
            </table>

            <!-- Event info -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
              style="background:#071428;border-radius:8px;margin-bottom:32px;">
              <tr>
                <td style="padding:20px 24px;">
                  <div style="font-size:11px;color:rgba(212,175,55,0.7);
                              letter-spacing:0.16em;text-transform:uppercase;margin-bottom:10px;">
                    Event Details
                  </div>
                  <div style="font-size:14px;color:#e8e0cc;margin-bottom:6px;">
                    📅 &nbsp;August 2026
                  </div>
                  <div style="font-size:14px;color:#e8e0cc;">
                    📍 &nbsp;Hyderabad, India
                  </div>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;color:#555;line-height:1.6;">
              Your attendee card (PNG) is attached to this email.
              Save it on your phone or print it for entry at the venue.
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;
                     padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
              EVENT 2026 Organizing Committee &nbsp;·&nbsp; Hyderabad, India<br/>
              This is a transactional email confirming your registration.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;

  // ── Mail options ─────────────────────────────────────────────────────────
  const mailOptions = {
    from,
    replyTo: from,
    to: email,
    subject: `EVENT 2026 — Registration Confirmed (${refId})`,

    // Both parts — critical for inbox delivery
    text: plainText,
    html: htmlBody,

    // Attached card
    attachments: [
      {
        filename: `${name.replace(/\s+/g, '-')}-Event2026-Card.png`,
        path: cardPath,
        contentType: 'image/png'
      }
    ],

    // Anti-spam & Primary Inbox headers
    headers: {
      'X-Priority': '3',                          // Normal priority (1=high = spammy)
      'X-Mailer': 'Nodemailer',
      'X-Auto-Response-Suppress': 'OOF, AutoReply', // Tell other servers not to auto-reply
      'Importance': 'normal'
    }
  };

  const info = await client.sendMail(mailOptions);

  // Offline fallback — log to file
  if (client.options && client.options.jsonTransport) {
    const emailDir = path.join(process.cwd(), 'sent-emails');
    if (!fs.existsSync(emailDir)) fs.mkdirSync(emailDir, { recursive: true });
    const emailFile = path.join(emailDir, `email_${registrant.id}_${Date.now()}.json`);
    fs.writeFileSync(emailFile, JSON.stringify(JSON.parse(info.message), null, 2));
    console.log(`[Email] Offline mode — saved to: ${emailFile}`);
  } else {
    console.log(`[Email] ✓ Sent to ${email} — MessageID: ${info.messageId}`);
  }

  return info;
}

module.exports = { sendConfirmationEmail };
