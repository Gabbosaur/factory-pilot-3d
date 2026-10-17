/**
 * Evolus RAG client (Memoria_Fabbrica). Server-only.
 * - search: OpenAI-compatible /v1/chat/completions on the memory agent (model "{appId}:{agentId}")
 * - save:   upload a markdown document into the agent's RAG memory (async ingestion)
 * Verified on 2026-10-17: REST works with X-ApiKey + X-Application-Id.
 */
import OpenAI from 'openai';
import { z } from 'zod';
import { MemoryEntrySchema } from '@/shared/schemas';
import type { MemoryEntry } from '@/shared/types';

const BASE = process.env.EVOLUS_BASE_URL ?? 'https://api.evolus.ai';
const KEY = () => process.env.EVOLUS_SPACE_APIKEY ?? '';
const APP = () => process.env.EVOLUS_APPLICATION_ID ?? '';
const AGENT = () => process.env.EVOLUS_MEMORY_AGENT_ID ?? '';
const MEMORY = () => process.env.EVOLUS_MEMORY_ID ?? '';

export function evolusConfigured(): boolean {
  return Boolean(KEY() && APP() && AGENT() && MEMORY());
}

export function restHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-ApiKey': KEY(), 'X-Application-Id': APP(), ...extra };
}

export const MEMORY_AGENT_PROMPT = `You are the FactoryPilot maintenance archive. Your memory contains closed maintenance interventions and machine sheets.
When you receive an incident description, search the memory for the most relevant past interventions (same machine or same machine type, similar sensors and symptoms).
Reply ONLY with valid JSON, no text before or after:
{"matches":[{"id":string,"machineId":string,"machineType":string,"sensorIds":string[],"realCause":string,"fix":string,"durationMin":integer,"closedAt":string ISO 8601,"isSample":boolean}]}
At most 3 items. Copy values exactly from the document metadata. If nothing is relevant reply {"matches":[]}. Never invent interventions.`;

/** Markdown document for one intervention, with front-matter holding the structured fields. */
export function entryToMarkdown(e: MemoryEntry): string {
  return `---
id: ${e.id}
machineId: ${e.machineId}
machineType: ${e.machineType}
sensorIds: [${e.sensorIds.join(', ')}]
durationMin: ${e.durationMin}
closedAt: ${e.closedAt}
isSample: ${e.isSample}
---
# Intervention ${e.id} – machine ${e.machineId} (${e.machineType})

- Closed at: ${e.closedAt}
- Sensors involved: ${e.sensorIds.join(', ')}
- Root cause: ${e.realCause}
- Work performed: ${e.fix}
- Duration: ${e.durationMin} minutes
${e.isSample ? '- Note: sample data for the demo\n' : ''}`;
}

const Matches = z.object({ matches: z.array(z.unknown()) });

export async function evolusSearch(query: {
  machineId: string;
  machineType: string;
  sensorIds: string[];
  symptom: string;
}): Promise<MemoryEntry[]> {
  const client = new OpenAI({ baseURL: `${BASE}/v1`, apiKey: KEY(), maxRetries: 1, timeout: 5000 });
  const res = await client.chat.completions.create({
    model: `${APP()}:${AGENT()}`,
    messages: [
      {
        role: 'user',
        content: `Incident: machine ${query.machineId} (type ${query.machineType}), sensors ${query.sensorIds.join(', ')}. Symptom: ${query.symptom}. Find similar past interventions.`,
      },
    ],
    max_tokens: 1500,
    temperature: 0,
  });
  const content = res.choices[0]?.message?.content ?? '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  const parsed = Matches.safeParse(JSON.parse(content.slice(start, end + 1)));
  if (!parsed.success) return [];
  // Keep only well-formed entries; never trust the model blindly.
  return parsed.data.matches.flatMap((m) => {
    const r = MemoryEntrySchema.safeParse(m);
    return r.success ? [r.data] : [];
  });
}

export async function evolusSave(entry: MemoryEntry): Promise<{ documentId: string | null }> {
  const form = new FormData();
  form.append('file', new Blob([entryToMarkdown(entry)], { type: 'text/markdown' }), `intervento-${entry.id}.md`);
  const res = await fetch(`${BASE}/api/v1/memories/${MEMORY()}/documents?language=en&backgroundIngestion=true`, {
    method: 'POST',
    headers: restHeaders(),
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Evolus upload ${res.status}`);
  const doc = (await res.json().catch(() => ({}))) as { id?: string };
  return { documentId: doc.id ?? null };
}

export async function evolusDelete(documentId: string): Promise<void> {
  await fetch(`${BASE}/api/v1/memories/${MEMORY()}/documents/${documentId}`, {
    method: 'DELETE',
    headers: restHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
}
