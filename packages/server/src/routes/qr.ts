import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';

export interface ConnectionInfo {
  host: string;
  port: number;
  ip: string;
  url: string;
}

export async function registerQR(app: FastifyInstance, getInfo: () => ConnectionInfo) {
  app.get<{ Querystring: { format?: string } }>('/qr', async (req, reply) => {
    const url = getInfo().url;
    const format = req.query.format ?? 'svg';
    if (format === 'png') {
      const buf = await QRCode.toBuffer(url, { type: 'png', margin: 1, width: 320 });
      reply.header('content-type', 'image/png').send(buf);
      return reply;
    }
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    reply.header('content-type', 'image/svg+xml').send(svg);
    return reply;
  });

  app.get('/api/connection', async () => getInfo());
}
