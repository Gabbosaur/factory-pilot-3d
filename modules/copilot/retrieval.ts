/**
 * Retrieval for "Ask FactoryPilot" (RAG over the technical manuals and the factory memory): picks the machines
 * the question is about, the most relevant manual pages (keyword scoring, no embeddings on the shared endpoints)
 * and past interventions; then verifies the sources the model cites. Pure.
 */
import type { FactoryConfig, MemoryEntry } from '@/shared/types';
import { parsePages, type ManualPage } from '@/modules/incidents/manual';
import { baseId } from '@/modules/plant/plant';

const STOP = new Set(
  'what which when where why how does this that there their with from into about should would could have will your machine line plant right now first look order mean tell give show please more most than then them they been were also only very much many each other some time shift'.split(' '),
);

export function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])].filter((w) => !STOP.has(w));
}

export interface RetrievedPage {
  machineId: string;
  manual: string;
  page: number;
  title: string;
  text: string;
}

export interface RetrievedIntervention {
  id: string;
  machineId: string;
  date: string;
  cause: string;
  fix: string;
  durationMin: number;
}

export interface Retrieval {
  machines: string[];
  manualPages: RetrievedPage[];
  interventions: RetrievedIntervention[];
}

/** Machines a plant-level question is about: named in the question, else the ones in trouble. */
export function machinesFor(question: string, factory: FactoryConfig, inTrouble: readonly string[], scopeMachine?: string): string[] {
  if (scopeMachine) return [scopeMachine];
  const q = question.toLowerCase();
  const named = factory.machines.filter((m) => new RegExp(`(^|[^a-z0-9-])${m.id.toLowerCase()}([^a-z0-9-]|$)`).test(q) || q.includes(m.name.toLowerCase().replace(/ \(l\d+\)$/, '')));
  if (named.length) return named.slice(0, 3).map((m) => m.id);
  const typeHit = factory.machines.filter((m) => keywords(q).some((k) => m.type.includes(k) || k.includes(m.type.split('_').pop()!)));
  return [...new Set([...inTrouble, ...typeHit.map((m) => m.id)])].slice(0, 3);
}

function score(text: string, kws: readonly string[]): number {
  const t = text.toLowerCase();
  return kws.reduce((acc, k) => acc + (t.split(k).length - 1), 0);
}

export function retrieve(
  question: string,
  factory: FactoryConfig,
  manuals: Record<string, string>,
  memory: readonly MemoryEntry[],
  inTrouble: readonly string[],
  scopeMachine?: string,
): Retrieval {
  const machines = machinesFor(question, factory, inTrouble, scopeMachine);
  const manualPages: RetrievedPage[] = [];
  const interventions: RetrievedIntervention[] = [];
  const seenManual = new Set<string>();
  for (const id of machines) {
    const m = factory.machines.find((x) => x.id === id);
    if (!m) continue;
    const kws = [...keywords(question), ...m.sensors.flatMap((s) => keywords(s.name))];
    // One manual can serve several machines of a plant (L1 and L2 pumps): retrieve it once.
    if (!seenManual.has(m.manualRef) && manuals[m.manualRef]) {
      seenManual.add(m.manualRef);
      const parsed = parsePages(manuals[m.manualRef]!);
      const pages: ManualPage[] = parsed.ok ? parsed.pages : [];
      // Question words drive the ranking; sensor names only break ties. The table of contents mentions
      // every topic, so it is used only when no content page matches.
      const qk = keywords(question);
      // A question word in the page title (e.g. "Spare parts", "Bearing replacement") weighs like several mentions.
      const title = (p: ManualPage) => p.text.split('\n')[0]!.toLowerCase();
      const scoredPages = pages
        .map((p) => ({
          p,
          toc: /contents:/i.test(p.text),
          s: score(p.text, qk) * 3 + qk.filter((k) => title(p).includes(k)).length * 5 + score(p.text, kws.filter((k) => !qk.includes(k))) * 0.2,
        }))
        .filter((x) => x.s > 0);
      const content = scoredPages.filter((x) => !x.toc);
      const ranked = (content.length ? content : scoredPages).sort((a, b) => b.s - a.s || a.p.n - b.p.n).slice(0, 3);
      for (const { p } of ranked) {
        manualPages.push({ machineId: m.id, manual: m.manualRef, page: p.n, title: p.text.split('\n')[0]!.replace(/^#+\s*/, '').slice(0, 80), text: p.text.slice(0, 1200) });
      }
    }
    const qk = keywords(question);
    memory
      .filter((e) => e.machineId === m.id || e.machineId === baseId(m.id) || e.machineType === m.type)
      .map((e) => ({ e, s: (e.machineId === m.id ? 3 : e.machineId === baseId(m.id) ? 2 : 1) + score(`${e.realCause} ${e.fix}`, qk) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 2)
      .forEach(({ e }) => {
        if (!interventions.some((x) => x.id === e.id))
          interventions.push({ id: e.id, machineId: e.machineId, date: e.closedAt.slice(0, 10), cause: e.realCause, fix: e.fix, durationMin: e.durationMin });
      });
  }
  return { machines, manualPages: manualPages.slice(0, 6), interventions: interventions.slice(0, 4) };
}

export interface CitedSource {
  type: 'manual' | 'memory';
  ref: string;
  page?: number;
}

/** A cited manual page must exist in that machine's manual; a cited intervention must exist in the memory. */
export function verifySource(s: CitedSource, factory: FactoryConfig, manuals: Record<string, string>, memory: readonly MemoryEntry[]): boolean {
  if (s.type === 'memory') return memory.some((e) => e.id === s.ref || e.closedAt.slice(0, 10) === s.ref);
  const m = factory.machines.find((x) => x.id === s.ref) ?? factory.machines.find((x) => x.manualRef === s.ref);
  const md = m ? manuals[m.manualRef] : manuals[s.ref];
  if (!md || !s.page) return false;
  const parsed = parsePages(md);
  return parsed.ok && parsed.pages.some((p) => p.n === s.page);
}
