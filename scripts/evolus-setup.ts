/**
 * One-time Evolus setup (idempotent). Creates the memory agent + its RAG memory and uploads seed docs.
 * Prints the env vars to add to .env.local. Uses only the application API key.
 *
 *   npx tsx --env-file=.env scripts/evolus-setup.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entryToMarkdown, MEMORY_AGENT_PROMPT, restHeaders } from '../server/evolus';
import type { MemoryEntry } from '../shared/types';

const BASE = process.env.EVOLUS_BASE_URL ?? 'https://api.evolus.ai';
const AGENT_NAME = 'factorypilot-maintenance-memory';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: restHeaders(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  if (!process.env.EVOLUS_SPACE_APIKEY || !process.env.EVOLUS_APPLICATION_ID) throw new Error('Set EVOLUS_SPACE_APIKEY and EVOLUS_APPLICATION_ID');

  const agents = await api<Array<{ agentId: string; name: string }>>('GET', '/api/v1/agents');
  let agent = agents.find((a) => a.name === AGENT_NAME);
  if (!agent) {
    agent = await api('POST', '/api/v1/agents', {
      name: AGENT_NAME,
      description: 'FactoryPilot 3D maintenance intervention archive (RAG)',
      prompt: MEMORY_AGENT_PROMPT,
      language: 'en',
      tags: ['factorypilot'],
      modelKey: process.env.EVOLUS_MEMORY_MODEL_KEY || null,
    });
    console.log('Created agent', agent!.agentId);
  } else console.log('Agent exists', agent.agentId);

  const memory = await api<{ id: string }>('POST', `/api/v1/agents/${agent!.agentId}/knowledge-memory`, { type: 0 });
  console.log('RAG memory', memory.id);

  const existing = await api<Array<{ title?: string | null }>>('GET', `/api/v1/memories/${memory.id}/documents`).catch(() => []);
  const titles = new Set((Array.isArray(existing) ? existing : []).map((d) => d.title ?? ''));

  const upload = async (name: string, content: string, type: string) => {
    if ([...titles].some((t) => t.includes(name.replace(/\.\w+$/, '')))) return console.log('  skip', name);
    const form = new FormData();
    form.append('file', new Blob([content], { type }), name);
    await api('POST', `/api/v1/memories/${memory.id}/documents?language=en&backgroundIngestion=true`, form);
    console.log('  uploaded', name);
  };

  const seed = JSON.parse(readFileSync(join(process.cwd(), 'data', 'memory-seed.json'), 'utf8')) as MemoryEntry[];
  for (const e of seed) await upload(`intervento-${e.id}.md`, entryToMarkdown(e), 'text/markdown');
  for (const m of ['pump-p1', 'filler-f1', 'capper-c1', 'conveyor-k1'])
    await upload(`manuale-${m}.md`, readFileSync(join(process.cwd(), 'data', 'manuals', `${m}.md`), 'utf8'), 'text/markdown');

  console.log('\nAdd to .env.local (and Vercel env):');
  console.log(`EVOLUS_MEMORY_AGENT_ID=${agent!.agentId}`);
  console.log(`EVOLUS_MEMORY_ID=${memory.id}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
