import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bottling from '../data/factories/bottling-line.json';
import twin from '../data/factories/bottling-line-twin.json';
import seed from '../data/memory-seed.json';
import { parseConfigValue } from '../modules/monitoring/config/parser';
import { buildPlant } from '../modules/plant/plant';
import { retrieve } from '../modules/copilot/retrieval';
import { evolusAsk, evolusSearch, evolusConfigured } from '../server/evolus';
import type { FactoryConfig, MemoryEntry } from '../shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error('invalid config');
  return r.config;
}

async function testLocalRag() {
  console.log('\n=== 1. TESTING LOCAL RAG (MANUALS + MEMORY SEED) ===');
  const factory = buildPlant('milan-plant', 'Genova plant – 2 water lines', [load(bottling), load(twin)]);
  const manuals = Object.fromEntries(
    ['pump-p1', 'filler-f1', 'capper-c1', 'conveyor-k1'].map((m) => [m, readFileSync(`data/manuals/${m}.md`, 'utf8')])
  );
  const memory = seed as MemoryEntry[];

  const query = 'How do I replace the bearing of the pump and which spare parts are needed?';
  console.log(`Query: "${query}" (Target: P1)`);
  const t0 = Date.now();
  const res = retrieve(query, factory, manuals, memory, [], 'P1');
  const dt = Date.now() - t0;

  console.log(`[Local RAG] Retrieved in ${dt}ms:`);
  console.log(`- Machines identified:`, res.machines);
  console.log(`- Manual pages retrieved:`, res.manualPages.map((p) => `p.${p.page} (${p.title})`));
  console.log(`- Past interventions matched:`, res.interventions.length);
  res.interventions.forEach((int) => {
    console.log(`  * [${int.id}] ${int.date} - Machine: ${int.machineId}`);
    console.log(`    Cause: "${int.cause}"`);
    console.log(`    Fix: "${int.fix}" (${int.durationMin} min)`);
  });
}

async function testEvolusCloudRag() {
  console.log('\n=== 2. TESTING EVOLUS CLOUD RAG (REMOTE KNOWLEDGE LIBRARY) ===');
  if (!evolusConfigured()) {
    console.log('Evolus not configured in environment.');
    return;
  }
  console.log('Evolus is configured. Calling live Evolus API...');

  // Test 1: evolusAsk
  const question = 'What are the steps to replace the filling valve seal and tare nozzle on filler F1?';
  console.log(`\n[Evolus Ask] Question: "${question}"`);
  const t0 = Date.now();
  try {
    const askRes = await evolusAsk(question, ['F1']);
    console.log(`[Evolus Ask] Answer received in ${askRes.latencyMs}ms:`);
    console.log('----------------------------------------------------');
    console.log(askRes.text);
    console.log('----------------------------------------------------');
  } catch (err) {
    console.error('[Evolus Ask] Error:', err instanceof Error ? err.message : err);
  }

  // Test 2: evolusSearch
  console.log(`\n[Evolus Memory Search] Searching past interventions for F1 fill_rejects...`);
  try {
    const searchRes = await evolusSearch({
      machineId: 'F1',
      machineType: 'filler',
      sensorIds: ['fill_rejects', 'flow_var'],
      symptom: 'Worn seal on filling valve causing fill-level rejects',
    });
    console.log(`[Evolus Search] Found ${searchRes.length} matching entries:`);
    searchRes.forEach((e) => {
      console.log(`  * ID: ${e.id} | Machine: ${e.machineId} | Closed: ${e.closedAt}`);
      console.log(`    Cause: ${e.realCause}`);
      console.log(`    Fix: ${e.fix} (${e.durationMin} min)`);
    });
  } catch (err) {
    console.error('[Evolus Search] Error:', err instanceof Error ? err.message : err);
  }
}

async function main() {
  await testLocalRag();
  await testEvolusCloudRag();
  console.log('\n=== RAG TEST COMPLETE ===');
}

main().catch(console.error);
