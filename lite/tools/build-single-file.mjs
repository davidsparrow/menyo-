/**
 * Bundle menyo lite into one self-contained .html file.
 *
 * The normal way to run this app is to host the lite/ folder and add it to an
 * iPad's home screen. The single file is for the other case: AirDropping or
 * emailing the whole app to a restaurant so they can open it straight from
 * Files with nothing to set up.
 *
 *   node lite/tools/build-single-file.mjs [outfile]
 *
 * Trade-offs of the single file: no service worker (file:// pages cannot
 * register one) and no "Add to Home Screen" icon, since both need a real
 * origin. Everything else — menu, ordering, receipts, QR codes, share links —
 * works exactly the same.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const liteDir = path.resolve(here, '..');
const outFile = path.resolve(process.argv[2] || path.join(liteDir, 'dist', 'menyo-lite.html'));

const bundled = await build({
  entryPoints: [path.join(liteDir, 'js', 'app.js')],
  bundle: true,
  format: 'iife',
  target: ['safari15'],
  minify: true,
  write: false,
  legalComments: 'none',
});

const script = bundled.outputFiles[0].text;
const css = await readFile(path.join(liteDir, 'css', 'styles.css'), 'utf8');
const sample = JSON.parse(await readFile(path.join(liteDir, 'sample-menu.json'), 'utf8'));
const iconSvg = await readFile(path.join(liteDir, 'icons', 'icon.svg'), 'utf8');
const appleIcon = await readFile(path.join(liteDir, 'icons', 'apple-touch-icon.png'));

const shell = await readFile(path.join(liteDir, 'index.html'), 'utf8');
const title = shell.match(/<title>([^<]*)<\/title>/)?.[1] || 'menyo lite';

// `</script>` inside JSON would end the script tag early.
const safeJson = JSON.stringify(sample).replace(/<\//g, '<\\/');

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <meta name="theme-color" content="#c2410c" />
    <meta name="color-scheme" content="light dark" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Order" />
    <link rel="apple-touch-icon" href="data:image/png;base64,${appleIcon.toString('base64')}" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}" />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="cartbar" class="cartbar" aria-live="polite"></div>
    <div id="toasts" class="toast-host" role="status" aria-live="polite"></div>

    <noscript>
      <div style="max-width: 640px; margin: 48px auto; padding: 0 20px; font-family: -apple-system, sans-serif">
        <h1>JavaScript is switched off</h1>
        <p>This ordering page needs JavaScript. Turn it on in Settings &rarr; Safari, then reload.</p>
      </div>
    </noscript>

    <script>window.__MENYO_SAMPLE_MENU__ = ${safeJson};</script>
    <script>${script}</script>
  </body>
</html>
`;

await writeFile(outFile, html, { encoding: 'utf8', flag: 'w' }).catch(async (err) => {
  if (err.code !== 'ENOENT') throw err;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, html, 'utf8');
});

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Wrote ${path.relative(process.cwd(), outFile)} (${kb} KB)`);
