import type { FastifyInstance } from 'fastify';
import type { SessionManager } from '../pty/manager.js';

export async function registerSessions(app: FastifyInstance, mgr: SessionManager) {
  app.get('/api/sessions', async () => ({ sessions: mgr.list() }));

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req) => {
    mgr.destroy(req.params.id);
    return { ok: true };
  });
}
