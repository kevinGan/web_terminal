import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { bookmarkStore, type Bookmark } from '../storage.js';

export async function registerBookmarks(app: FastifyInstance, dataDir: string) {
  const store = bookmarkStore(dataDir);

  app.get('/api/bookmarks', async () => {
    return store.read();
  });

  app.post<{ Body: { label?: string; path: string } }>('/api/bookmarks', async (req, reply) => {
    const { label, path } = req.body ?? ({} as { label?: string; path: string });
    if (!path || typeof path !== 'string') {
      reply.code(400); return { error: 'path required' };
    }
    const next: Bookmark = {
      id: randomUUID(),
      label: label?.trim() || path.split('/').filter(Boolean).pop() || path,
      path,
      addedAt: Date.now()
    };
    const list = store.update((cur) => {
      if (cur.some((b) => b.path === path)) return cur;
      return [next, ...cur];
    });
    return { bookmark: next, all: list };
  });

  app.delete<{ Params: { id: string } }>('/api/bookmarks/:id', async (req) => {
    const { id } = req.params;
    const list = store.update((cur) => cur.filter((b) => b.id !== id));
    return { all: list };
  });

  app.put<{ Params: { id: string }; Body: { label?: string } }>('/api/bookmarks/:id', async (req, reply) => {
    const { id } = req.params;
    const { label } = req.body ?? {};
    const list = store.update((cur) => cur.map((b) => (b.id === id ? { ...b, label: label?.trim() || b.label } : b)));
    if (!list.some((b) => b.id === id)) {
      reply.code(404); return { error: 'not_found' };
    }
    return { all: list };
  });
}
