/**
 * Modalità_Replay (Req 18). Recording writes JSON files only in local dev (RECORD_MODE=1);
 * on Vercel recordings are read from the statically imported index bundled with the deploy.
 * Server-only.
 */
import { createHash } from 'node:crypto';
import index from '@/data/replay/index.json';

export interface Recording {
  agent: string;
  scenarioId: string;
  hash: string;
  model: string;
  content: string;
  recordedAt: string;
}

const recordings = index as unknown as Recording[];

export function requestHash(agent: string, model: string, messages: unknown): string {
  return createHash('sha256').update(JSON.stringify({ agent, model, messages })).digest('hex');
}

export function isReplayDefault(): boolean {
  return process.env.REPLAY_MODE === '1';
}

/** Exact hash match first, then the most recent recording for the same agent + scenario (Req 18.2, 18.3). */
export function findRecording(agent: string, scenarioId: string, hash: string): Recording | null {
  const exact = recordings.find((r) => r.hash === hash);
  if (exact) return exact;
  const same = recordings
    .filter((r) => r.agent === agent && r.scenarioId === scenarioId)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  return same[0] ?? null;
}

/** Local dev only: persist a successful response so it can be committed and replayed on Vercel. */
export async function saveRecording(rec: Recording): Promise<void> {
  if (process.env.RECORD_MODE !== '1' || process.env.VERCEL) return;
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'data', 'replay');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${rec.agent}.${rec.scenarioId}.${rec.hash.slice(0, 16)}.json`), JSON.stringify(rec, null, 2));
}
