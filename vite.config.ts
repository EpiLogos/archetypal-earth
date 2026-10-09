import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The Red Book's facsimile plates are copyrighted Norton pages: they stay out of
 * git and out of dist. This dev-only route streams them from the vault's own
 * copy on this machine; any build or other host gets 404 and the page degrades
 * to a cited note (see curation/redbook.json).
 */
function redbookPlates(): Plugin {
  const vault = process.env.VAULT || path.join(os.homedir(), 'Documents', 'books', 'jung-archetypal-field');
  const dir = path.join(vault, '_raw', 'redbook', 'plates');
  const prefix = '/redbook-plates/';
  return {
    name: 'redbook-plates',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        const name = path.basename(decodeURIComponent(req.url.slice(prefix.length).split('?')[0]));
        if (!/^[a-z0-9_.-]+$/i.test(name)) { res.statusCode = 404; return res.end(); }
        const full = path.join(dir, name);
        if (!fs.existsSync(full)) { res.statusCode = 404; return res.end(); }
        res.setHeader('content-type', 'image/jpeg');
        res.setHeader('cache-control', 'no-store');
        fs.createReadStream(full).pipe(res);
      });
    },
  };
}

export default defineConfig({
  server: { port: 5181 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  plugins: [redbookPlates()],
});
