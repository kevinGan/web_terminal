import type { FastifyInstance } from 'fastify';
import { workspaceStore, type WorkspaceState } from '../storage.js';

export async function registerWorkspaceState(app: FastifyInstance, dataDir: string) {
  const store = workspaceStore(dataDir);

  app.get('/api/state', async () => store.read());

  app.put<{ Body: Partial<WorkspaceState> }>('/api/state', async (req, reply) => {
    const body = req.body ?? {};
    if (!Array.isArray(body.tabs)) {
      reply.code(400);
      return { error: 'tabs must be an array' };
    }
    const next: WorkspaceState = {
      schemaVersion: typeof body.schemaVersion === 'number' ? body.schemaVersion : 1,
      tabs: body.tabs,
      activeTabId: typeof body.activeTabId === 'string' ? body.activeTabId : '',
      idCounter: typeof body.idCounter === 'number' ? body.idCounter : 0
    };
    store.write(next);
    return { ok: true };
  });
}
