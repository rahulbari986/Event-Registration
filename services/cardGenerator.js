const { createCanvas, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

/**
 * Generates the official 9th Edition TiA Summit Attendee Card.
 * Matches the layout and styling of the reference card image.
 * 
 * @param {Object} registrant - Registrant data from DB (name, city, photo_path)
 * @returns {Promise<Buffer>} - PNG buffer
 */
async function generateCard(registrant) {
  const width = 1024;
  const height = 682;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // ─── 1. Clean White Background ─────────────────────────────────────────────
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // ─── 2. Decorative Network Diagram (Background) ──────────────────────────
  const nodes = [
    { x: 460, y: 340 },
    { x: 520, y: 335 },
    { x: 530, y: 250 },
    { x: 585, y: 245 },
    { x: 595, y: 310 },
    { x: 595, y: 410 },
    { x: 520, y: 170 }
  ];

  ctx.strokeStyle = 'rgba(161, 27, 81, 0.08)';
  ctx.lineWidth = 1;
  // Connect some nodes
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [1, 4], [2, 6], [0, 5]
  ];
  connections.forEach(([i, j]) => {
    ctx.beginPath();
    ctx.moveTo(nodes[i].x, nodes[i].y);
    ctx.lineTo(nodes[j].x, nodes[j].y);
    ctx.stroke();
  });

  // Draw node dots
  ctx.fillStyle = 'rgba(161, 27, 81, 0.12)';
  nodes.forEach(node => {
    ctx.beginPath();
    ctx.arc(node.x, node.y, 4, 0, Math.PI * 2);
    ctx.fill();
    // Inner small dot
    ctx.fillStyle = 'rgba(161, 27, 81, 0.2)';
    ctx.beginPath();
    ctx.arc(node.x, node.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(161, 27, 81, 0.12)';
  });

  // ─── 3. Decorative Dot Grids ───────────────────────────────────────────────
  const drawDotGrid = (startX, startY, cols, rows, spacing, color) => {
    ctx.fillStyle = color;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.beginPath();
        ctx.arc(startX + c * spacing, startY + r * spacing, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  drawDotGrid(520, 370, 5, 5, 8, 'rgba(11, 26, 64, 0.15)');
  drawDotGrid(800, 240, 6, 4, 8, 'rgba(11, 26, 64, 0.15)');

  // ─── 4. Pink/Magenta Accent Wave (Behind main wave) ────────────────────────
  ctx.fillStyle = '#d81b60'; // Bright pink/magenta accent
  ctx.beginPath();
  ctx.moveTo(0, 390);
  ctx.bezierCurveTo(200, 405, 340, 305, 480, 350);
  ctx.bezierCurveTo(620, 320, 680, 230, 850, 250);
  ctx.bezierCurveTo(940, 230, 1000, 170, 1024, 160);
  ctx.lineTo(1024, 682);
  ctx.lineTo(0, 682);
  ctx.closePath();
  ctx.fill();

  // ─── 5. Main Gradient Wave ──────────────────────────────────────────────────
  const waveGrad = ctx.createLinearGradient(0, 300, 1024, 682);
  waveGrad.addColorStop(0, '#a11b51');    // Deep pink/red on left
  waveGrad.addColorStop(0.35, '#561877'); // Purple in middle-left
  waveGrad.addColorStop(0.7, '#141d66');  // Royal blue in middle-right
  waveGrad.addColorStop(1, '#070e3b');    // Deep navy on right

  ctx.fillStyle = waveGrad;
  ctx.beginPath();
  // Shift slightly down and right from the background wave to let pink edge peek out
  ctx.moveTo(0, 396);
  ctx.bezierCurveTo(200, 411, 340, 311, 480, 356);
  ctx.bezierCurveTo(620, 326, 680, 236, 850, 256);
  ctx.bezierCurveTo(940, 236, 1000, 176, 1024, 166);
  ctx.lineTo(1024, 682);
  ctx.lineTo(0, 682);
  ctx.closePath();
  ctx.fill();

  // ─── 6. City Skyline Outline (Over wave) ──────────────────────────────────
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1.5;
  const drawBuilding = (x, w, h, roofType = 'flat') => {
    const y = 682 - h;
    ctx.beginPath();
    ctx.moveTo(x, 682);
    ctx.lineTo(x, y);
    if (roofType === 'flat') {
      ctx.lineTo(x + w, y);
    } else if (roofType === 'pointed') {
      ctx.lineTo(x + w / 2, y - 15);
      ctx.lineTo(x + w, y);
    } else if (roofType === 'spire') {
      ctx.lineTo(x + w / 2, y - 8);
      ctx.lineTo(x + w / 2, y - 35);
      ctx.lineTo(x + w / 2, y - 8);
      ctx.lineTo(x + w, y);
    }
    ctx.lineTo(x + w, 682);
    ctx.stroke();
  };

  // Draw some simple stylized building outlines
  drawBuilding(420, 30, 80);
  drawBuilding(455, 25, 110, 'pointed');
  drawBuilding(485, 40, 95);
  drawBuilding(530, 35, 130, 'spire');
  drawBuilding(570, 25, 75);
  
  // Right side buildings (under photo name area)
  drawBuilding(820, 30, 140, 'spire');
  drawBuilding(855, 25, 90);
  drawBuilding(885, 35, 160, 'pointed');
  drawBuilding(925, 40, 110);
  drawBuilding(970, 25, 135, 'spire');

  // ─── 7. Top Left Logo (Stylized '9' with crest + text) ──────────────────────
  // We draw the big 9 using path
  const logoX = 112;
  const logoY = 138;
  
  // Circular top loop of '9'
  const logoGrad = ctx.createLinearGradient(logoX - 35, logoY - 35, logoX + 35, logoY + 45);
  logoGrad.addColorStop(0, '#a11b51');
  logoGrad.addColorStop(0.5, '#561877');
  logoGrad.addColorStop(1, '#141d66');
  
  ctx.strokeStyle = logoGrad;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  // Arc for top loop of 9
  ctx.arc(logoX, logoY - 12, 22, -Math.PI * 0.2, Math.PI * 1.5, false);
  // Tail of 9 sweeping down
  ctx.bezierCurveTo(logoX + 22, logoY + 10, logoX - 10, logoY + 38, logoX - 25, logoY + 35);
  ctx.stroke();

  // Draw seal inside the loop of 9
  ctx.fillStyle = '#141d66';
  ctx.beginPath();
  ctx.arc(logoX, logoY - 12, 14, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(logoX, logoY - 12, 11, 0, Math.PI * 2);
  ctx.stroke();

  // Crest star inside seal
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '8px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TiA', logoX, logoY - 12);

  // Tiny red wing on the right of the 9 loop
  ctx.fillStyle = '#a11b51';
  ctx.beginPath();
  ctx.arc(logoX + 26, logoY - 10, 4, 0, Math.PI * 2);
  ctx.fill();

  // Text next to Logo
  const textX = logoX + 45;
  ctx.fillStyle = '#0b1a40';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('EDITION OF', textX, logoY - 6);

  ctx.font = 'bold 36px Arial, sans-serif';
  ctx.fillText('TiA SUMMIT', textX, logoY + 28);

  ctx.font = '900 11.5px Arial, sans-serif';
  ctx.fillStyle = '#0b1a40';
  // Simulate letter spacing
  const subtitle = 'THE INDIA ADVOCATE SUMMIT';
  let subX = textX;
  for (let i = 0; i < subtitle.length; i++) {
    ctx.fillText(subtitle[i], subX, logoY + 46);
    subX += ctx.measureText(subtitle[i]).width + 2.2;
  }

  // ─── 8. Top Right Attending Text ───────────────────────────────────────────
  const attX = 560;
  const attY = 126;
  ctx.fillStyle = '#0b1a40';
  ctx.font = '500 24px Arial, sans-serif';
  ctx.fillText("I'm attending the", attX, attY);

  // Colored text line: "9th Edition of #TIASUMMIT"
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.fillStyle = '#a11b51'; // Red/Pink
  ctx.fillText('9', attX, attY + 32);
  
  let currentX = attX + ctx.measureText('9').width;
  ctx.fillStyle = '#0b1a40'; // Navy
  ctx.fillText('th', currentX, attY + 24); // smaller superscript look
  
  currentX += ctx.measureText('th').width + 4;
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.fillText('Edition of ', currentX, attY + 32);
  
  currentX += ctx.measureText('Edition of ').width;
  ctx.fillStyle = '#a11b51'; // Red/Pink
  ctx.fillText('#TIASUMMIT', currentX, attY + 32);

  // ─── 9. Attendee Profile Picture ──────────────────────────────────────────
  const photoCenterX = 738;
  const photoCenterY = 286;
  const photoRad = 114;

  // Outer Navy Ring
  ctx.strokeStyle = '#0b1a40';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(photoCenterX, photoCenterY, photoRad + 5, 0, Math.PI * 2);
  ctx.stroke();

  // Inner Pink Ring
  ctx.strokeStyle = '#a11b51';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(photoCenterX, photoCenterY, photoRad + 2, 0, Math.PI * 2);
  ctx.stroke();

  // White separator ring & Clip Mask
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
    ctx.restore();

    // Draw fallback initials text
    const nameParts = (registrant.name || 'Attendee').trim().split(' ').filter(Boolean);
    const initials = nameParts.length > 1
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : nameParts[0].substring(0, 2).toUpperCase();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 78px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, photoCenterX, photoCenterY + 4);
  } else {
    ctx.restore();
  }

  // ─── 10. Dynamic Attendee Details (Name, Role, City) ───────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Attendee Name
  ctx.fillStyle = '#FFFFFF';
  const attendeeName = (registrant.name || '').trim();
  let nameSize = 28;
  ctx.font = `bold ${nameSize}px Arial, sans-serif`;
  // Decrease font size if name is too wide
  while (ctx.measureText(attendeeName).width > 240 && nameSize > 16) {
    nameSize -= 1.5;
    ctx.font = `bold ${nameSize}px Arial, sans-serif`;
  }
  ctx.fillText(attendeeName, photoCenterX, 428);

  // Attendee Designation / Role
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = '500 16px Arial, sans-serif';
  ctx.fillText('Attendee Delegate', photoCenterX, 456);

  // Attendee City
  const attendeeCity = (registrant.city || '').trim();
  ctx.fillText(attendeeCity, photoCenterX, 480);

  // ─── 11. Bottom Left Info Icons (Calendar, Pin) ───────────────────────────
  ctx.textAlign = 'left';

  // Calendar Icon
  const calX = 58;
  const calY = 450;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'miter';
  ctx.strokeRect(calX, calY, 26, 22);
  // Grid lines inside calendar
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(calX, calY + 7);
  ctx.lineTo(calX + 26, calY + 7);
  ctx.stroke();
  // Two small hooks on top
  ctx.beginPath();
  ctx.moveTo(calX + 6, calY - 3); ctx.lineTo(calX + 6, calY + 2);
  ctx.moveTo(calX + 20, calY - 3); ctx.lineTo(calX + 20, calY + 2);
  ctx.stroke();

  // Date Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillText('15 & 16 Oct, 2026', calX + 38, calY + 18);

  // Map Pin Icon
  const pinX = 62;
  const pinY = 510;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  // Pin head
  ctx.arc(pinX, pinY - 10, 7, -Math.PI, 0, false);
  // Teardrop curves
  ctx.bezierCurveTo(pinX + 7, pinY - 10, pinX + 7, pinY - 4, pinX, pinY + 4);
  ctx.bezierCurveTo(pinX - 7, pinY - 4, pinX - 7, pinY - 10, pinX, pinY - 10);
  ctx.stroke();
  // Inner pin hole
  ctx.beginPath();
  ctx.arc(pinX, pinY - 10, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // Venue Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '500 18.5px Arial, sans-serif';
  ctx.fillText('West End Hotel, Taj West End, Bengaluru', calX + 38, pinY - 4);

  // Separator Line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(58, 550);
  ctx.lineTo(460, 550);
  ctx.stroke();

  // ─── 12. Bottom Left Powered By Branding ──────────────────────────────────
  const pbX = 58;
  const pbY = 566;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('Powered by', pbX, pbY);

  // Micelio Logo Icon (Styled intersecting green/cyan polygons)
  const logoSize = 18;
  const logoCenterY = pbY + 20;
  ctx.fillStyle = '#39b54a'; // Green
  ctx.beginPath();
  ctx.moveTo(pbX, logoCenterY - logoSize);
  ctx.lineTo(pbX + 11, logoCenterY - 4);
  ctx.lineTo(pbX + 4, logoCenterY + 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#00aeef'; // Cyan
  ctx.beginPath();
  ctx.moveTo(pbX + 8, logoCenterY + 12);
  ctx.lineTo(pbX + 22, logoCenterY - 2);
  ctx.lineTo(pbX + 12, logoCenterY - logoSize);
  ctx.closePath();
  ctx.fill();

  // Micelio Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.fillText('micelio', pbX + 28, logoCenterY + 4);

  // Micelio Subtitle
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '900 8.5px Arial, sans-serif';
  const pbSub = 'EVENTS & PUBLIC RELATIONS';
  let pbSubX = pbX;
  for (let i = 0; i < pbSub.length; i++) {
    ctx.fillText(pbSub[i], pbSubX, logoCenterY + 18);
    pbSubX += ctx.measureText(pbSub[i]).width + 1.2;
  }

  // ─── 13. Bottom Center Website ─────────────────────────────────────────────
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 18.5px Arial, sans-serif';
  ctx.fillText('www.triasummit.com', 228, 590);

  // ─── 14. Bottom Right "AI" Glowing Chip Badge ──────────────────────────────
  const chipX = 884;
  const chipY = 546;
  const chipSize = 44; // Half-diagonal of diamond

  // Outer glowing lines/circuits
  ctx.strokeStyle = 'rgba(0, 174, 239, 0.25)';
  ctx.lineWidth = 1.5;
  const drawCircuitLine = (sx, sy, ex, ey) => {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Tiny node at endpoint
    ctx.fillStyle = 'rgba(0, 174, 239, 0.4)';
    ctx.beginPath();
    ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
    ctx.fill();
  };
  drawCircuitLine(chipX - chipSize, chipY, chipX - chipSize - 20, chipY - 10);
  drawCircuitLine(chipX + chipSize, chipY, chipX + chipSize + 20, chipY + 10);
  drawCircuitLine(chipX, chipY - chipSize, chipX - 10, chipY - chipSize - 22);
  drawCircuitLine(chipX, chipY + chipSize, chipX + 10, chipY + chipSize + 22);

  // Rotate canvas 45 deg to draw diamond
  ctx.save();
  ctx.translate(chipX, chipY);
  ctx.rotate(Math.PI / 4);

  // Outer Glowing Border
  ctx.strokeStyle = 'rgba(0, 174, 239, 0.8)';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = '#00aeef';
  ctx.shadowBlur = 10;
  ctx.strokeRect(-32, -32, 64, 64);
  ctx.shadowBlur = 0; // Reset shadow

  // Inner Navy Fill
  ctx.fillStyle = '#061030';
  ctx.fillRect(-30, -30, 60, 60);

  ctx.restore();

  // "AI" text inside chip
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AI', chipX, chipY + 2);

  return canvas.toBuffer('image/png');
}

module.exports = { generateCard };
