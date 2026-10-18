/**
 * Uploads the technical manuals and the sample interventions into the configured Evolus memory
 * (EVOLUS_MEMORY_ID). Idempotent: documents already present (same title) are skipped. Creates nothing else.
 *
 *   npx tsx --env-file=.env.local scripts/evolus-upload-docs.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entryToMarkdown, restHeaders } from '../server/evolus';
import type { MemoryEntry } from '../shared/types';

const BASE = process.env.EVOLUS_BASE_URL ?? 'https://api.evolus.ai';
const MEMORY = process.env.EVOLUS_MEMORY_ID;

async function main() {
  if (!MEMORY || !process.env.EVOLUS_SPACE_APIKEY || !process.env.EVOLUS_APPLICATION_ID) throw new Error('Set EVOLUS_SPACE_APIKEY, EVOLUS_APPLICATION_ID and EVOLUS_MEMORY_ID');
  const list = await fetch(`${BASE}/api/v1/memories/${MEMORY}/documents`, { headers: restHeaders() });
  if (!list.ok) throw new Error(`list documents → ${list.status}`);
  const j = (await list.json()) as unknown;
  const docs = (Array.isArray(j) ? j : ((j as { items?: unknown[] }).items ?? [])) as Array<{ title?: string }>;
  const titles = new Set(docs.map((d) => d.title ?? ''));

  const upload = async (name: string, content: string) => {
    if (titles.has(name)) return console.log('  skip (present)', name);
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/markdown' }), name);
    const res = await fetch(`${BASE}/api/v1/memories/${MEMORY}/documents?language=en&backgroundIngestion=true`, { method: 'POST', headers: restHeaders(), body: form });
    if (!res.ok) throw new Error(`upload ${name} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log('  uploaded', name);
  };

  // Technical manuals (page markers <!-- page: N --> are kept so passages can be cited by page).
  for (const f of readdirSync(join(process.cwd(), 'data', 'manuals')).filter((f) => f.endsWith('.md')).sort())
    await upload(`manual-${f}`, readFileSync(join(process.cwd(), 'data', 'manuals', f), 'utf8'));
  // Sample closed interventions (factory memory seed).
  const seed = JSON.parse(readFileSync(join(process.cwd(), 'data', 'memory-seed.json'), 'utf8')) as MemoryEntry[];
  for (const e of seed) await upload(`intervento-${e.id}.md`, entryToMarkdown(e));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
