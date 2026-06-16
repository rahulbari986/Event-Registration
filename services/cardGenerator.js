const { createCanvas, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

/**
 * Generates the official TiA Summit Attendee Card using the provided background image.
 * 
 * @param {Object} registrant - Registrant data from DB (name, city, photo_path)
 * @returns {Promise<Buffer>} - PNG buffer
 */
async function generateCard(registrant) {
  const width = 1536;
  const height = 1024;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Load the background card template
  const bgPath = path.join(process.cwd(), 'card.jpeg');
  let bgImg;
  try {
    bgImg = await loadImage(bgPath);
    ctx.drawImage(bgImg, 0, 0, width, height);
  } catch (err) {
    console.error('[Card] Background image not found at', bgPath, err);
    // Fallback basic background if card.jpeg is missing
    ctx.fillStyle = '#141d66';
    ctx.fillRect(0, 0, width, height);
  }

  // 1. Profile Photo
  const photoCenterX = 1107;
  const photoCenterY = 429;
  const photoRad = 171;

  ctx.save();
  ctx.beginPath();
  ctx.arc(photoCenterX, photoCenterY, photoRad, 0, Math.PI * 2);
  ctx.clip();

  let photoLoaded = false;
  if (registrant.photo_path) {
    try {
      const absPath = path.join(process.cwd(), registrant.photo_path);
      if (fs.existsSync(absPath)) {
        const img = await loadImage(absPath);
        const scale = Math.max((photoRad * 2) / img.width, (photoRad * 2) / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, photoCenterX - w / 2, photoCenterY - h / 2, w, h);
        photoLoaded = true;
      }
    } catch (e) {
      console.warn(`[Card] Failed to render custom photo, using initials instead:`, e.message);
    }
  }

  if (!photoLoaded) {
    // Falls back to initials on gradient background
    const initialsGrad = ctx.createLinearGradient(photoCenterX - photoRad, photoCenterY - photoRad, photoCenterX + photoRad, photoCenterY + photoRad);
    initialsGrad.addColorStop(0, '#a11b51');
    initialsGrad.addColorStop(1, '#561877');
    ctx.fillStyle = initialsGrad;
    ctx.fillRect(photoCenterX - photoRad, photoCenterY - photoRad, photoRad * 2, photoRad * 2);

    // Draw fallback initials text
    const nameParts = (registrant.name || 'Attendee').trim().split(' ').filter(Boolean);
    const initials = nameParts.length > 1
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : nameParts[0].substring(0, 2).toUpperCase();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 110px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, photoCenterX, photoCenterY + 4);
  }
  ctx.restore();

  // 2. User Details (Name, Role, City)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  
  const attendeeName = (registrant.name || '').trim();
  let nameSize = 42;
  ctx.font = `bold ${nameSize}px Arial, sans-serif`;
  // Decrease font size if name is too wide
  while (ctx.measureText(attendeeName).width > 350 && nameSize > 24) {
    nameSize -= 2;
    ctx.font = `bold ${nameSize}px Arial, sans-serif`;
  }
  ctx.fillText(attendeeName, photoCenterX, 642);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = '500 24px Arial, sans-serif';
  ctx.fillText('Attendee Delegate', photoCenterX, 684);

  const attendeeCity = (registrant.city || '').trim();
  ctx.fillText(attendeeCity, photoCenterX, 720);

  // 3. Date and Location
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 33px Arial, sans-serif';
  ctx.fillText('15 & 16 Oct, 2026', 144, 702);

  ctx.font = '500 28px Arial, sans-serif';
  ctx.fillText('West End Hotel, Taj West End, Bengaluru', 144, 765);

  return canvas.toBuffer('image/png');
}

module.exports = { generateCard };
