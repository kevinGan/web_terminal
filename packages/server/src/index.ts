import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

import { loadConfig } from './config.js';
import { ensureDataDir, seedClaudeCommandsIfNeeded } from './storage.js';
import { loadOrCreateToken, makeAuthHook } from './auth.js';
import { makeLanGuard } from './lan-guard.js';
import { SessionManager } from './pty/manager.js';
import { registerTerminalWS } from './ws/terminal.js';
import { registerBookmarks } from './routes/bookmarks.js';
import { registerHistory } from './routes/history.js';
import { registerFiles } from './routes/files.js';
import { registerSnippets } from './routes/snippets.js';
import { registerClaudeCommands } from './routes/claude-commands.js';
import { registerQR } from './routes/qr.js';
import { registerSessions } from './routes/sessions.js';
import { registerWorkspaceState } from './routes/state.js';

async function main() {
  const config = loadConfig(process.argv.slice(2));
  ensureDataDir(config.dataDir);
  seedClaudeCommandsIfNeeded(config.dataDir);
  const token = config.noAuth ? '' : loadOrCreateToken(config.dataDir);
  const authOpts = { token, enabled: !config.noAuth };

  const app = Fastify({ logger: { level: 'info' }, trustProxy: false });
  await app.register(websocketPlugin, { options: { maxPayload: 4 * 1024 * 1024 } });

  app.addHook('onRequest', makeLanGuard());
  // Auth applied per-route below (websocket handles auth on its own).
  const authHook = makeAuthHook(authOpts);

  const mgr = new SessionManager(config);

  app.register(async (api) => {
    api.addHook('onRequest', authHook);
    await registerBookmarks(api, config.dataDir);
    await registerHistory(api);
    await registerFiles(api, config.allowedRoots);
    await registerSnippets(api, config.dataDir);
    await registerClaudeCommands(api, config.dataDir);
    await registerSessions(api, mgr);
    await registerWorkspaceState(api, config.dataDir);
  });

  // Connection info & QR are gated by host check only — they expose URL+token.
  // Token is REQUIRED to view the QR (which embeds the same token).
  app.register(async (api) => {
    api.addHook('onRequest', authHook);
    await registerQR(api, () => buildConnectionUrl(config.host, config.port, token));
  });

  registerTerminalWS(app, mgr, authOpts);

  // Serve static frontend if built
  const staticDir = resolveStaticDir(config.staticDir);
  if (staticDir) {
    await app.register(staticPlugin, { root: staticDir, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        reply.sendFile('index.html', staticDir);
        return;
      }
      reply.code(404).send({ error: 'not_found' });
    });
  } else {
    app.get('/', async () => ({
      message: 'Web Terminal server is running. Frontend not built; run `pnpm dev` for development.',
      docs: 'GET /api/sessions, /api/bookmarks, /api/history/cd, /api/files, /api/snippets',
      ws: '/ws/terminal'
    }));
  }

  const cleanup = () => {
    mgr.destroyAll();
    app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await app.listen({ host: config.host, port: config.port });

  printBanner(config.host, config.port, token, !config.noAuth);
}

function buildConnectionUrl(host: string, port: number, token: string): string {
  const ip = pickAdvertisedIp(host);
  const base = `http://${ip}:${port}/`;
  return token ? `${base}?token=${token}` : base;
}

function pickAdvertisedIp(bindHost: string): string {
  if (bindHost && bindHost !== '0.0.0.0' && bindHost !== '::') return bindHost;
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

function resolveStaticDir(override: string | null): string | null {
  if (override && existsSync(override)) return override;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../web/dist'),
    resolve(here, '../../../web/dist'),
    resolve(here, '../public')
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

async function printBanner(host: string, port: number, token: string, authEnabled: boolean): Promise<void> {
  const url = buildConnectionUrl(host, port, token);
  const ip = pickAdvertisedIp(host);
  const lines: string[] = [];
  lines.push('');
  lines.push('  ╔════════════════════════════════════════════════════════╗');
  lines.push('  ║              Web Terminal listening                    ║');
  lines.push('  ╚════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Local:    http://127.0.0.1:${port}/`);
  lines.push(`  Network:  http://${ip}:${port}/`);
  if (authEnabled) {
    lines.push(`  Token:    ${token.slice(0, 8)}…${token.slice(-4)}`);
    lines.push(`  Open:     ${url}`);
  } else {
    lines.push('  Auth:     DISABLED (--no-token). Bind to localhost only!');
  }
  lines.push('');
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  if (authEnabled) {
    try {
      const qr = await QRCode.toString(url, { type: 'terminal', small: true });
      // eslint-disable-next-line no-console
      console.log(qr);
    } catch {}
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
