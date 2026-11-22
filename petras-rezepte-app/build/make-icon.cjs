/** Erzeugt build/icon.ico aus web/public/icon.svg (einmalig; benötigt Playwright). */
const { chromium } = require('playwright');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
(async () => {
  const svg = readFileSync(join(__dirname, '..', 'web', 'public', 'icon.svg'), 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  const sizes = [16, 24, 32, 48, 64, 128, 256]; const pngs = [];
  for (const s of sizes) {
    await p.setViewportSize({ width: s, height: s });
    await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
    pngs.push(await p.screenshot({ omitBackground: true }));
  }
  await b.close();
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length; const dir = [];
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length; dir.push(e);
  });
  writeFileSync(join(__dirname, 'icon.ico'), Buffer.concat([header, ...dir, ...pngs]));
  console.log('✓ build/icon.ico');
})();
