// Local preview: serves dist/ under the same base path GitHub Pages uses.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const BASE = process.env.BASE_PATH ?? '/Android-Interview-Questions/';
const PORT = Number(process.env.PORT ?? 4321);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!url.startsWith(BASE)) { res.writeHead(302, { location: BASE }); return res.end(); }
  let file = path.join(DIST, url.slice(BASE.length));
  if (!file.startsWith(DIST)) { res.writeHead(400); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  const found = fs.existsSync(file);
  if (!found) file = path.join(DIST, '404.html');
  res.writeHead(found ? 200 : 404, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}${BASE}`));
