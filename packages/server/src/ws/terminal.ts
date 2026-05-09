import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { SessionManager } from '../pty/manager.js';
import type { AuthOptions } from '../auth.js';
import { extractToken } from '../auth.js';
import { isAllowed } from '../lan-guard.js';

interface ClientInitMessage {
  type: 'init';
  sessionId?: string;
  cols: number;
  rows: number;
  cwd?: string;
}

interface ClientResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

interface ClientPingMessage {
  type: 'ping';
}

type ClientControl = ClientInitMessage | ClientResizeMessage | ClientPingMessage;

export function registerTerminalWS(app: FastifyInstance, mgr: SessionManager, auth: AuthOptions) {
  app.get('/ws/terminal', { websocket: true }, (socket, req) => {
    handleConnection(socket, req, mgr, auth);
  });
}

function handleConnection(
  socket: WebSocket,
  req: FastifyRequest,
  mgr: SessionManager,
  auth: AuthOptions
) {
  if (!isAllowed(req.ip)) {
    safeClose(socket, 4003, 'forbidden_remote_ip');
    return;
  }
  if (auth.enabled) {
    const tok = extractToken(req);
    if (!tok || tok !== auth.token) {
      safeClose(socket, 4001, 'unauthorized');
      return;
    }
  }

  let session: ReturnType<SessionManager['attachOrCreate']> | null = null;
  const disposers: Array<() => void> = [];

  const onSocketMessage = (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    if (isBinary) {
      if (session) session.write(asBuffer(raw));
      return;
    }
    let msg: ClientControl;
    try {
      msg = JSON.parse(asBuffer(raw).toString('utf8')) as ClientControl;
    } catch { return; }
    if (msg.type === 'init') {
      if (session) return; // already initialized
      session = mgr.attachOrCreate({
        id: msg.sessionId,
        cols: clampDim(msg.cols, 80),
        rows: clampDim(msg.rows, 24),
        cwd: msg.cwd
      });
      // `replayed` lets the client decide whether to write its own
      // localStorage scrollback snapshot: when the server has the buffer
      // (true), client stays quiet to avoid duplication; when this is a fresh
      // PTY (false, e.g. after server restart), client paints its snapshot.
      const snap = session.snapshot();
      sendJson(socket, {
        type: 'ready',
        sessionId: session.id,
        cwd: session.cwd,
        title: session.title,
        replayed: snap.length > 0
      });
      if (snap.length > 0) socket.send(snap);
      // Stream new data
      disposers.push(session.onData((chunk) => socket.send(chunk)));
      disposers.push(session.onCwd((path) => sendJson(socket, { type: 'cwd', path })));
      disposers.push(session.onTitle((text) => sendJson(socket, { type: 'title', text })));
      disposers.push(session.onExit((ev) => {
        sendJson(socket, { type: 'exit', exitCode: ev.exitCode, signal: ev.signal });
        safeClose(socket, 1000, 'pty_exited');
      }));
    } else if (msg.type === 'resize') {
      if (session) session.resize(clampDim(msg.cols, 80), clampDim(msg.rows, 24));
    } else if (msg.type === 'ping') {
      sendJson(socket, { type: 'pong' });
    }
  };

  socket.on('message', onSocketMessage);
  socket.on('close', () => {
    for (const d of disposers) d();
    if (session) mgr.softClose(session.id);
  });
  socket.on('error', () => {
    for (const d of disposers) d();
    if (session) mgr.softClose(session.id);
  });
}

function asBuffer(raw: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

function clampDim(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(500, Math.max(10, Math.floor(v)));
}

function sendJson(socket: WebSocket, obj: unknown) {
  try { socket.send(JSON.stringify(obj)); } catch {}
}

function safeClose(socket: WebSocket, code: number, reason: string) {
  try { socket.close(code, reason); } catch {}
}
