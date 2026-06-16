const fs = require('fs');
const path = require('path');

/**
 * Sends a registration confirmation email with the attendee card attached.
 * Uses Resend's HTTP API for maximum speed in serverless environments.
 * Fallbacks to offline file logging when credentials are missing.
 *
 * @param {Object} registrant  - DB row
 * @param {string} cardPath    - Absolute path to the generated card PNG
 */
async function sendConfirmationEmail(registrant, cardPath) {
  const apiKey = process.env.SMTP_PASS || process.env.RESEND_API_KEY;
  const from = process.env.SMTP_FROM || 'Event 2026 <onboarding@resend.dev>';
  
  const refId  = `EVT-2026-${String(registrant.id).padStart(5, '0')}`;
  const name   = registrant.name   || 'Attendee';
  const email  = registrant.email;
  const phone  = registrant.phone  || '—';
  const city   = registrant.city   || '—';

  // Read card file and convert to base64 for attachment
  let cardBase64 = '';
  try {
    if (fs.existsSync(cardPath)) {
      const buffer = fs.readFileSync(cardPath);
      cardBase64 = buffer.toString('base64');
    }
  } catch (e) {
    console.error('[Email] Failed to read card for attachment:', e.message);
  }

  // Plain text version (critical for spam filters)
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

  // HTML version
  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>EVENT 2026 — Registration Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600"
        style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;
               box-shadow:0 4px 24px rgba(0,0,0,0.08);">
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
        <tr>
          <td style="height:3px;background:linear-gradient(90deg,#AA7C11,#F2CA50,#AA7C11);"></td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#071428;">
              Hello ${name},
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
              Your registration for <strong>EVENT 2026</strong> has been confirmed!
              Your attendee card is attached below — please bring it to the event.
            </p>
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

  // Send request using Resend's REST API
  if (apiKey && apiKey.startsWith('re_')) {
    console.log(`[Email] Sending confirmation to ${email} via Resend HTTP REST API...`);
    
    const attachments = [];
    if (cardBase64) {
      attachments.push({
        content: cardBase64,
        filename: `${name.replace(/\s+/g, '-')}-Event2026-Card.png`
      });
    }

    const payload = {
      from,
      to: [email],
      subject: `EVENT 2026 — Registration Confirmed (${refId})`,
      text: plainText,
      html: htmlBody,
      attachments
    };

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Resend API Error: ${data.message || response.statusText}`);
      }
      console.log(`[Email] ✓ Sent successfully via Resend. MessageID: ${data.id}`);
      return data;
    } catch (fetchErr) {
      console.error('[Email] Resend API request failed:', fetchErr);
      throw fetchErr;
    }
  } else {
    // Offline / Local Development Fallback
    console.warn('[Email] Resend API key missing or invalid — using offline JSON transport. Emails will NOT be sent.');
    const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
    const emailDir = isVercel ? '/tmp/sent-emails' : path.join(process.cwd(), 'sent-emails');
    if (!fs.existsSync(emailDir)) fs.mkdirSync(emailDir, { recursive: true });
    
    const emailFile = path.join(emailDir, `email_${registrant.id}_${Date.now()}.json`);
    const mockMsg = {
      to: email,
      from,
      subject: `EVENT 2026 — Registration Confirmed (${refId})`,
      text: plainText,
      html: htmlBody,
      cardPath
    };
    fs.writeFileSync(emailFile, JSON.stringify(mockMsg, null, 2));
    console.log(`[Email] Offline mode — saved details to: ${emailFile}`);
    return { id: `offline_${Date.now()}` };
  }
}

module.exports = { sendConfirmationEmail };
