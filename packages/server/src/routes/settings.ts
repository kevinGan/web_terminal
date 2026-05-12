import type { FastifyInstance } from 'fastify';
import type { AuthOptions } from '../auth.js';
import { rotateToken, writeToken } from '../auth.js';

export interface SettingsRouteDeps {
  dataDir: string;
  authOpts: AuthOptions;
}

/**
 * Token management endpoints. All require valid auth via the parent route group.
 *
 * The hot-update relies on the fact that `authOpts` is the same object reference
 * shared with the HTTP authHook and the WebSocket handler — mutating its
 * `token` field takes effect on the very next request, no restart required.
 */
export async function registerSettings(app: FastifyInstance, deps: SettingsRouteDeps) {
  const { dataDir, authOpts } = deps;

  app.get('/api/settings/token', async () => ({
    token: authOpts.token,
    enabled: authOpts.enabled
  }));

  app.put<{ Body: { token?: string } }>('/api/settings/token', async (req, reply) => {
    if (!authOpts.enabled) {
      reply.code(409).send({ error: 'auth_disabled' });
      return;
    }
    const raw = (req.body?.token ?? '').toString();
    const next = raw.trim();
    if (next.length < 1) {
      reply.code(400).send({ error: 'token_empty' });
      return;
    }
    writeToken(dataDir, next);
    authOpts.token = next;
    return { ok: true, token: next };
  });

  app.post('/api/settings/token/rotate', async (_req, reply) => {
    if (!authOpts.enabled) {
      reply.code(409).send({ error: 'auth_disabled' });
      return;
    }
    const next = rotateToken(dataDir);
    authOpts.token = next;
    return { ok: true, token: next };
  });
}
