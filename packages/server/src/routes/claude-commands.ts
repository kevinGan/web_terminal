import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { claudeCommandStore, type ClaudeCommand } from '../storage.js';

export async function registerClaudeCommands(app: FastifyInstance, dataDir: string) {
  const store = claudeCommandStore(dataDir);

  app.get('/api/claude-commands', async () => store.read());

  app.post<{ Body: { label?: string; command: string; autoSubmit?: boolean } }>(
    '/api/claude-commands',
    async (req, reply) => {
      const { label, command, autoSubmit } = req.body ?? ({} as { label?: string; command: string; autoSubmit?: boolean });
      if (!command || typeof command !== 'string') {
        reply.code(400); return { error: 'command required' };
      }
      const next: ClaudeCommand = {
        id: randomUUID(),
        label: label?.trim() || command.slice(0, 32),
        command,
        autoSubmit: autoSubmit ?? true,
        addedAt: Date.now()
      };
      const list = store.update((cur) => [...cur, next]);
      return { command: next, all: list };
    }
  );

  app.put<{ Params: { id: string }; Body: { label?: string; command?: string; autoSubmit?: boolean } }>(
    '/api/claude-commands/:id',
    async (req, reply) => {
      const { id } = req.params;
      const { label, command, autoSubmit } = req.body ?? {};
      let found = false;
      const list = store.update((cur) =>
        cur.map((c) => {
          if (c.id !== id) return c;
          found = true;
          return {
            ...c,
            label: label?.trim() ?? c.label,
            command: command ?? c.command,
            autoSubmit: autoSubmit ?? c.autoSubmit
          };
        })
      );
      if (!found) { reply.code(404); return { error: 'not_found' }; }
      return { all: list };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/claude-commands/:id', async (req) => {
    const list = store.update((cur) => cur.filter((c) => c.id !== req.params.id));
    return { all: list };
  });

  app.put<{ Body: { ids: string[] } }>('/api/claude-commands/reorder', async (req, reply) => {
    const ids = req.body?.ids ?? [];
    if (!Array.isArray(ids)) { reply.code(400); return { error: 'ids required' }; }
    const list = store.update((cur) => {
      const map = new Map(cur.map((c) => [c.id, c]));
      const ordered: ClaudeCommand[] = [];
      for (const id of ids) {
        const c = map.get(id);
        if (c) { ordered.push(c); map.delete(id); }
      }
      // Append any leftover (shouldn't happen if client sent full list)
      for (const leftover of map.values()) ordered.push(leftover);
      return ordered;
    });
    return { all: list };
  });
}
