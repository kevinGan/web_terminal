import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { snippetStore, type Snippet } from '../storage.js';

export async function registerSnippets(app: FastifyInstance, dataDir: string) {
  const store = snippetStore(dataDir);

  app.get('/api/snippets', async () => store.read());

  app.post<{ Body: { label?: string; command: string } }>('/api/snippets', async (req, reply) => {
    const { label, command } = req.body ?? ({} as { label?: string; command: string });
    if (!command || typeof command !== 'string') {
      reply.code(400); return { error: 'command required' };
    }
    const next: Snippet = {
      id: randomUUID(),
      label: label?.trim() || command.slice(0, 24),
      command,
      addedAt: Date.now()
    };
    const list = store.update((cur) => [next, ...cur]);
    return { snippet: next, all: list };
  });

  app.delete<{ Params: { id: string } }>('/api/snippets/:id', async (req) => {
    const list = store.update((cur) => cur.filter((s) => s.id !== req.params.id));
    return { all: list };
  });
}
