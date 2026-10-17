/**
 * Browser-side FIFO queue for inference requests (Req 17.6): ≤4 concurrent, ≤20 per sliding 60 s.
 * Server answers { retryable, retryAfterMs } are re-queued after the suggested delay (Req 17.14).
 */
import type { ApiResult } from '@/shared/types';

const MAX_CONCURRENT = 4;
const MAX_PER_MINUTE = 20;
const MAX_CLIENT_RETRIES = 3;

type Job = { run: () => Promise<void> };

const queue: Job[] = [];
const sentAt: number[] = [];
let active = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function pump() {
  timer = null;
  const now = Date.now();
  while (sentAt.length && now - sentAt[0]! > 60_000) sentAt.shift();
  while (queue.length && active < MAX_CONCURRENT && sentAt.length < MAX_PER_MINUTE) {
    const job = queue.shift()!;
    active++;
    sentAt.push(Date.now());
    job.run().finally(() => {
      active--;
      pump();
    });
  }
  if (queue.length && !timer) {
    const wait = sentAt.length >= MAX_PER_MINUTE ? 60_000 - (Date.now() - sentAt[0]!) + 50 : 250;
    timer = setTimeout(pump, Math.max(50, wait));
  }
}

export function queueStats() {
  return { queued: queue.length, active, lastMinute: sentAt.length };
}

/** POST JSON to an inference route through the queue. Network failures resolve to ok:false. */
export function enqueuePost<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    let attempts = 0;
    const job: Job = {
      run: async () => {
        attempts++;
        let res: ApiResult<T>;
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          res = (await r.json()) as ApiResult<T>;
        } catch {
          res = { ok: false, retryable: true, retryAfterMs: 2000, error: 'AI service unreachable' };
        }
        if (!res.ok && res.retryable && attempts <= MAX_CLIENT_RETRIES) {
          setTimeout(() => {
            queue.push(job);
            pump();
          }, res.retryAfterMs ?? 2000);
          return;
        }
        resolve(res);
      },
    };
    queue.push(job);
    pump();
  });
}
