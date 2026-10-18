/**
 * Protects the shared AMD key on the public demo URL: a sliding-window limit per client IP and a global
 * budget per warm instance. Over the limit the routes serve recorded answers (Replay) instead of live calls.
 * In-memory, so it is per serverless instance: a cheap brake for a demo, not a billing guarantee. Server-only.
 */
const PER_IP_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 20);
const GLOBAL_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR ?? 400);

const perIp = new Map<string, number[]>();
let global: number[] = [];

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

/** Counts this request; true when the caller (or the whole instance) is over budget. */
export function overLimit(req: Request, now = Date.now()): boolean {
  const ip = clientIp(req);
  const mine = (perIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  global = global.filter((t) => now - t < 3_600_000);
  const over = mine.length >= PER_IP_PER_MIN || global.length >= GLOBAL_PER_HOUR;
  if (!over) {
    mine.push(now);
    global.push(now);
  }
  perIp.set(ip, mine);
  if (perIp.size > 5000) perIp.clear(); // bound memory on a long-lived instance
  if (over) console.warn('[guard]', JSON.stringify({ ip: ip.slice(0, 7) + '…', mine: mine.length, global: global.length }));
  return over;
}

export const LIMIT_MESSAGE = 'Too many AI requests right now: try again in a minute (recorded answers are served meanwhile).';
