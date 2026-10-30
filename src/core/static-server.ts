// A tiny static file server bound to 127.0.0.1, used to audit static builds (`jourilo serve`, `audit --dir`)
// and the benchmark fixtures. Optional `jourilo-fixture.json` in the root can delay paths to simulate slow
// resources: { "delays": { "/hero.jpg": 3000 } }.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { JouriloError } from './errors.js';
import { resolveInside } from './fs-safety.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

export async function serveStatic(root: string, port = 0): Promise<StaticServer> {
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new JouriloError('NOT_FOUND', `Not a directory: ${root}`);
  const cfgFile = join(root, 'jourilo-fixture.json');
  const cfg = existsSync(cfgFile)
    ? (JSON.parse(readFileSync(cfgFile, 'utf8')) as { delays?: Record<string, number> })
    : {};
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    const delay = cfg.delays?.[pathname] ?? 0;
    const send = () => {
      try {
        let file = resolveInside(root, `.${pathname}`);
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
        if (!existsSync(file) && !extname(pathname)) {
          const html = resolveInside(root, `.${pathname}.html`);
          if (existsSync(html)) file = html;
        }
        if (!existsSync(file)) {
          const notFound = join(root, '404.html');
          res.writeHead(404, { 'content-type': TYPES['.html']! });
          res.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found');
          return;
        }
        res.writeHead(200, {
          'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(readFileSync(file));
      } catch {
        res.writeHead(403);
        res.end('Forbidden');
      }
    };
    pathname = pathname.replace(/\/+$/, '') || '/';
    if (delay > 0) setTimeout(send, delay);
    else send();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
