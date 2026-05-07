import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Allow loopback + RFC1918 private ranges.
 * Reject anything else even if Fastify happens to bind 0.0.0.0.
 */
export function makeLanGuard() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ip = req.ip;
    if (isAllowed(ip)) return;
    reply.code(403).send({ error: 'forbidden_remote_ip', ip });
  };
}

export function isAllowed(ip: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) return isAllowed(ip.slice(7));
  if (ip === 'localhost') return true;
  // 10.0.0.0/8
  if (ip.startsWith('10.')) return true;
  // 192.168.0.0/16
  if (ip.startsWith('192.168.')) return true;
  // 172.16.0.0/12
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    if (parts.length >= 2) {
      const second = Number(parts[1]);
      if (second >= 16 && second <= 31) return true;
    }
  }
  // fc00::/7 (ULA) and fe80::/10 (link-local)
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}
