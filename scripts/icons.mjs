import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Mechanical app-asset sizing and UI animation frames from the approved artwork.
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  const data = `data:image/png;base64,${(await readFile('assets/downloader-icon.png')).toString('base64')}`;
  const images = await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const output = {};
    for (const size of [16, 32, 48, 128, 256]) {
      for (const mode of ['idle', ...(size <= 32 ? ['available', 'detected', 'download', 'available-download'] : [])]) {
        const animated = !['idle', 'available'].includes(mode);
        for (let frame = 0; frame < (animated ? 8 : 1); frame++) {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
          const ctx = canvas.getContext('2d');
          // Whole-icon movement remains visible at the toolbar's 16px size.
          const offset = animated ? [0, -1, -2, -1, 0, 1, 2, 1][frame] * size / 16 : 0;
          ctx.drawImage(image, 0, offset, size, size);
          if (mode === 'detected') {
            ctx.strokeStyle = `rgba(65,238,255,${.25 + .7 * Math.sin(Math.PI * frame / 7)})`;
            ctx.lineWidth = Math.max(1, size / 16);
            ctx.beginPath(); ctx.roundRect(size * .08, size * .08, size * .84, size * .84, size * .22); ctx.stroke();
          }
          if (mode.endsWith('download')) {
            for (let particle = 0; particle < 3; particle++) {
              const offset = (frame + particle * 3) % 8;
              ctx.globalAlpha = .4 + .6 * offset / 7;
              ctx.fillStyle = particle === 1 ? '#fa4aff' : '#d9ffff';
              ctx.fillRect(size * (.68 + (particle % 2) * .11), size * (.15 + offset * .08), Math.max(1, size / 12), Math.max(1, size / 12));
            }
          }
          if (mode.startsWith('available') || mode === 'detected') {
            ctx.globalAlpha = 1; ctx.fillStyle = '#3ce8ff'; ctx.strokeStyle = '#101318'; ctx.lineWidth = size * .09;
            ctx.beginPath(); ctx.arc(size * .77, size * .77, size * .17, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
          }
          output[`${mode === 'idle' ? '' : animated ? `${mode}-${frame}-` : `${mode}-`}${size}.png`] = canvas.toDataURL('image/png').split(',')[1];
        }
      }
    }
    return output;
  }, data);
  await mkdir('static/icons', { recursive: true });
  for (const [name, base64] of Object.entries(images)) await writeFile(`static/icons/${name}`, Buffer.from(base64, 'base64'));
  console.log(`Wrote ${Object.keys(images).length} icon assets.`);
} finally { await browser.close(); }
