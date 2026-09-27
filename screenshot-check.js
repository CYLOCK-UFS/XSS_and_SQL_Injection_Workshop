const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  // home
  await page.goto('http://localhost:3100/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'screenshot-home-1440.png', fullPage: false });
  
  // mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.screenshot({ path: 'screenshot-home-390.png', fullPage: false });
  
  // bank page to check shield on all pages
  await page.goto('http://localhost:3100/banco/agencias', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'screenshot-agencias-390.png', fullPage: false });
  
  // receitas
  await page.goto('http://localhost:3100/receitas', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'screenshot-receitas-390.png', fullPage: false });
  
  await browser.close();
  console.log('Screenshots saved');
}

run().catch(e => { console.error(e); process.exit(1); });