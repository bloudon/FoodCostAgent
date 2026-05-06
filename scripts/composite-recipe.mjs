import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCR = path.resolve(__dirname, '../client/public/screenshots');

// Target composite: 1400×800 side-by-side
const TOTAL_W = 1400;
const TOTAL_H = 800;
const PAD = 32;

// Sizes for each half
const CARD_W = 560;   // recipe card (portrait 3:4)
const CARD_H = TOTAL_H - PAD * 2;
const PHONE_W = 340;  // phone screenshot
const PHONE_H = Math.round(PHONE_W * (844 / 390)); // maintain aspect ratio

async function main() {
  // Load and resize the handwritten recipe card
  const card = await sharp(`${SCR}/handwritten-recipe-card.png`)
    .resize(CARD_W, CARD_H, { fit: 'cover', position: 'centre' })
    .toBuffer();

  // Load and resize the mobile recipe screenshot
  const phone = await sharp(`${SCR}/mobile-recipe-builder.jpg`)
    .resize(PHONE_W, PHONE_H, { fit: 'contain', background: '#f8f7f4' })
    .extend({
      top: 28, bottom: 28, left: 14, right: 14,
      background: '#1a1a1a'   // phone bezel colour
    })
    .toBuffer();

  // Get actual phone buffer dimensions after extend
  const phoneMeta = await sharp(phone).metadata();
  const pW = phoneMeta.width;
  const pH = phoneMeta.height;

  // Warm parchment background for the whole canvas
  const canvas = {
    width: TOTAL_W,
    height: TOTAL_H,
    channels: 3,
    background: { r: 245, g: 238, b: 225 }
  };

  // Positions
  const cardLeft = PAD;
  const cardTop  = PAD;
  const phoneLeft = CARD_W + PAD * 2 + Math.round((TOTAL_W - CARD_W - PAD * 3 - pW) / 2);
  const phoneTop  = Math.round((TOTAL_H - pH) / 2);

  // Divider line position
  const dividerX = CARD_W + PAD + Math.round(PAD / 2);

  // Build SVG overlays: divider + labels
  const svg = `
<svg width="${TOTAL_W}" height="${TOTAL_H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Divider -->
  <line x1="${dividerX}" y1="${PAD * 2}" x2="${dividerX}" y2="${TOTAL_H - PAD * 2}"
        stroke="#c4a97d" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.6"/>
  <!-- Labels -->
  <text x="${cardLeft + CARD_W / 2}" y="${TOTAL_H - 10}"
        font-family="Georgia,serif" font-size="13" fill="#8a7560" text-anchor="middle"
        opacity="0.9">The old way</text>
  <text x="${phoneLeft + pW / 2}" y="${TOTAL_H - 10}"
        font-family="-apple-system,sans-serif" font-size="13" fill="#e85d04" text-anchor="middle"
        font-weight="600">FNB Cost Pro</text>
  <!-- Arrow between -->
  <text x="${dividerX}" y="${TOTAL_H / 2 + 6}"
        font-family="sans-serif" font-size="22" fill="#e85d04" text-anchor="middle">→</text>
</svg>`.trim();

  const svgBuf = Buffer.from(svg);

  await sharp({ create: canvas })
    .composite([
      { input: card,    left: cardLeft,  top: cardTop },
      { input: phone,   left: phoneLeft, top: phoneTop },
      { input: svgBuf,  top: 0, left: 0 },
    ])
    .png()
    .toFile(`${SCR}/recipe-card-vs-app.png`);

  console.log(`✅ Composite saved → recipe-card-vs-app.png`);
  console.log(`   Canvas: ${TOTAL_W}×${TOTAL_H}`);
  console.log(`   Card: ${CARD_W}×${CARD_H} @ (${cardLeft},${cardTop})`);
  console.log(`   Phone: ${pW}×${pH} @ (${phoneLeft},${phoneTop})`);
}

main().catch(err => { console.error(err); process.exit(1); });
