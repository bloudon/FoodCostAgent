import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:5000';
const OUT = path.resolve(__dirname, '../client/public/screenshots');

const EMAIL = 'owner@breakfastnook.com';
const PASS  = 'Nook2024!';

const EXEC = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--disable-software-rasterizer', '--no-zygote',
  '--single-process', '--mute-audio',
];

async function login(page) {
  // ?app param sets sessionStorage forceAppMode so the app router is active
  await page.goto(`${BASE_URL}/login?app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(2500);
  console.log('✓ Logged in');
}

async function go(page, url, ms = 2200) {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(ms);
}

async function shot(page, file, label) {
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`  ✓ ${label}`);
}

async function captureDesktop() {
  const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);

  await login(page);

  await go(page, '/inventory-items', 2500);
  await shot(page, 'inventory-management.png', 'inventory-management');

  await go(page, '/recipes/bn-r-06/edit', 3000);
  await shot(page, 'recipe-costing.png', 'recipe-costing');

  await go(page, '/vendors', 2200);
  await shot(page, 'vendor-order-guides.png', 'vendor-order-guides');

  await go(page, '/tfc/variance', 2200);
  await shot(page, 'food-cost-variance.png', 'food-cost-variance');

  await go(page, '/inventory-sessions', 2200);
  await shot(page, 'inventory-counting.png', 'inventory-counting');

  // Multi-location: dashboard with store dropdown open
  await go(page, '/', 2200);
  try {
    const btn = page.locator('button').filter({ hasText: /Uptown/i }).first();
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(800);
  } catch { /* capture as-is */ }
  await shot(page, 'multi-location.png', 'multi-location');

  await browser.close();
  console.log('Desktop done ✓');
}

async function captureMobile() {
  const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ARGS });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);

  await login(page);

  await go(page, '/inventory-sessions', 2200);
  await shot(page, 'mobile-count-session.jpg', 'mobile-count-session');

  await go(page, '/new-count', 2200);
  await shot(page, 'mobile-count-items.jpg', 'mobile-count-items');

  await go(page, '/waste', 2200);
  await shot(page, 'mobile-waste-log.jpg', 'mobile-waste-log');

  await go(page, '/recipes/bn-r-06', 3000);
  await shot(page, 'mobile-recipe-builder.jpg', 'mobile-recipe-builder');

  await browser.close();
  console.log('Mobile done ✓');
}

(async () => {
  console.log('── Desktop screenshots ──');
  await captureDesktop();
  console.log('\n── Mobile screenshots ──');
  await captureMobile();
  console.log('\n✅ All 10 screenshots saved to client/public/screenshots/');
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
