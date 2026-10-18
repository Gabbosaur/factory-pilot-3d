/**
 * Client_LLM for AMD Token Factory (Req 17). Server-only: reads the API key from env.
 * - one system message at index 0 + one user message (shape that works on every shared model)
 * - retries only 429 / 502 / 503 / timeouts / network errors, honouring Retry-After
 * - returns a "retryable" result when the function deadline would be exceeded (Req 17.14)
 * - replay mode and recording (Req 18)
 */
import OpenAI from 'openai';
import { findRecording, isReplayDefault, requestHash, saveRecording } from './replay';
import { LIMIT_MESSAGE } from '@/server/guard';

export type Agent = 'diagnosi' | 'sicurezza' | 'onboarding' | 'copilota' | 'visione' | 'pianificatore';

interface ModelChoice {
  primary: string;
  fallback?: string;
  reasoningEffort?: 'none' | 'low' | 'medium';
  /** Qwen3.8-Flash-Next thinks (xhigh) when reasoning_effort is omitted: force 'none' on the fallback. */
  fallbackReasoningEffort?: 'none' | 'low' | 'medium';
  maxTokens: number;
  /** Per-attempt timeout (default CALL_TIMEOUT_MS); long generations like onboarding need more. */
  timeoutMs?: number;
}

/** Verified against GET /v1/models on 2026-10-17. Gemma accepts no reasoning_effort (on/off only). */
export const MODELS: Record<Agent, ModelChoice> = {
  // No reasoning_effort: per the Token Factory guide DeepSeek-V4-Flash does not think when it is omitted,
  // which keeps latency predictable ('low'/'medium' enable thinking and were measured at 16–45+ s).
  diagnosi: { primary: 'DeepSeek-V4-Flash', fallback: 'Qwen3.8-Flash-Next', fallbackReasoningEffort: 'none', maxTokens: 3000 },
  sicurezza: { primary: 'Gemma-4-31B-IT', fallback: 'DeepSeek-V4-Flash', maxTokens: 800 },
  // Q&A over the live plant data (one call per question).
  copilota: { primary: 'DeepSeek-V4-Flash', fallback: 'Qwen3.8-Flash-Next', fallbackReasoningEffort: 'none', maxTokens: 1200 },
  // Visual inspection of a product photo: Gemma is the multimodal model of the catalog.
  visione: { primary: 'Gemma-4-31B-IT', maxTokens: 800, timeoutMs: 45_000 },
  // Recovery planner agent (Gemma: tool choice + plan), one short step per call; DeepSeek as fallback.
  pianificatore: { primary: 'Gemma-4-31B-IT', fallback: 'DeepSeek-V4-Flash', maxTokens: 1000, timeoutMs: 40_000 },
  // A whole factory draft: one long attempt fits the 60 s route better than two short ones that both time out.
  onboarding: { primary: 'DeepSeek-V4-Flash', fallback: 'Qwen3.8-Flash-Next', fallbackReasoningEffort: 'none', maxTokens: 3000, timeoutMs: 50_000 },
};

export interface CallInput {
  agent: Agent;
  scenarioId: string;
  incidentId?: string;
  system: string;
  user: string;
  /** Optional image (data URL) sent with the user message, for multimodal models. */
  image?: string;
  replay?: boolean;
  /** The caller is over the rate limit (server/guard.ts): serve a recording, never a live call. */
  limited?: boolean;
  /** Absolute epoch ms by which we must return to the browser. */
  deadline: number;
}

export interface CallMeta {
  agent: Agent;
  model: string;
  latencyMs: number;
  inTok: number;
  outTok: number;
  replay: boolean;
}

export type CallResult =
  | { ok: true; content: string; meta: CallMeta }
  | { ok: false; retryable: boolean; retryAfterMs?: number; error: string };

const BASE_URL = process.env.AMD_TOKENFACTORY_BASE_URL ?? 'https://developer.amd.com.cn/radeon/api/v1';
/** Per-attempt timeout: short enough that a fallback attempt still fits in one 60 s serverless invocation. */
const CALL_TIMEOUT_MS = 25_000;
/** After repeated transient failures the primary model is skipped for a while (per warm instance). */
const DEGRADED_MS = 5 * 60_000;
const degradedUntil = new Map<string, number>();
const MAX_RETRIES = 5;

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  const key = process.env.AMD_TOKENFACTORY_APIKEY;
  if (!key) return null;
  if (!client) client = new OpenAI({ baseURL: BASE_URL, apiKey: key, maxRetries: 0, timeout: CALL_TIMEOUT_MS });
  return client;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.AMD_TOKENFACTORY_APIKEY);
}

// ---- model catalog cache (Req 17.4, 17.5, 17.11) ----
let catalog: { at: number; ids: Set<string> } | null = null;
export async function availableModels(): Promise<Set<string> | null> {
  if (catalog && Date.now() - catalog.at < 10 * 60_000) return catalog.ids;
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.models.list({ timeout: 10_000 });
    catalog = { at: Date.now(), ids: new Set(res.data.map((m) => m.id)) };
    return catalog.ids;
  } catch (err) {
    console.warn('[llm] GET /v1/models failed, using configured models unverified:', errMsg(err));
    return null;
  }
}

async function pickModel(agent: Agent): Promise<string | null> {
  const choice = MODELS[agent];
  const ids = await availableModels();
  const degraded = (degradedUntil.get(choice.primary) ?? 0) > Date.now();
  if (degraded && choice.fallback && (!ids || ids.has(choice.fallback))) return choice.fallback;
  if (!ids) return choice.primary;
  if (ids.has(choice.primary)) return choice.primary;
  console.warn(`[llm] model ${choice.primary} for ${agent} not in catalog`);
  if (choice.fallback && ids.has(choice.fallback)) return choice.fallback;
  return null;
}

function errMsg(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    // Gateway errors: {error:{...}}; platform errors: {detail:{error:{...}}}; check both.
    const body = err.error as { message?: string; detail?: { error?: { message?: string } } } | undefined;
    return body?.detail?.error?.message ?? body?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function retryDelayMs(err: unknown, attempt: number): number | null {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === 429) {
      const ra = Number(err.headers?.get?.('retry-after'));
      if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 60) * 1000;
    } else if (status !== undefined && status !== 502 && status !== 503 && status < 500) {
      return null; // other 4xx: not retryable
    }
  }
  const base = 1000 * 2 ** attempt; // 1, 2, 4, 8, 16 s
  return base * (0.8 + Math.random() * 0.4);
}

function isTransient(err: unknown): boolean {
  if (err instanceof OpenAI.APIError && err.status !== undefined) return err.status === 502 || err.status === 503;
  return true; // timeouts and network errors
}

function log(meta: Partial<CallMeta> & { outcome: string; incidentId?: string }) {
  console.log('[llm]', JSON.stringify(meta));
}

export async function callLLM(input: CallInput): Promise<CallResult> {
  const { agent, scenarioId, system, user } = input;
  const messages = [
    { role: 'system' as const, content: system },
    input.image
      ? { role: 'user' as const, content: [{ type: 'text' as const, text: user }, { type: 'image_url' as const, image_url: { url: input.image } }] }
      : { role: 'user' as const, content: user },
  ];
  const replay = input.replay ?? (isReplayDefault() || !hasApiKey());
  const model = await pickModel(agent);
  const hash = requestHash(agent, model ?? MODELS[agent].primary, messages);

  if (replay || input.limited) {
    const rec = findRecording(agent, scenarioId, hash);
    if (!rec) return { ok: false, retryable: false, error: input.limited && !replay ? LIMIT_MESSAGE : 'No replay recording for this agent and scenario' };
    const meta: CallMeta = { agent, model: rec.model, latencyMs: 0, inTok: 0, outTok: 0, replay: true };
    log({ ...meta, outcome: input.limited ? 'replay_rate_limited' : 'replay', incidentId: input.incidentId });
    return { ok: true, content: rec.content, meta };
  }
  const live = await callLive(input, messages, model, hash);
  if (live.ok || live.retryable || agent === 'onboarding') return live;
  // The live call failed for good (quota, key, outage): a recorded answer for the same scenario keeps the demo alive.
  const rec = findRecording(agent, scenarioId, hash);
  if (!rec) return live;
  const meta: CallMeta = { agent, model: rec.model, latencyMs: 0, inTok: 0, outTok: 0, replay: true };
  log({ ...meta, outcome: 'replay_fallback', incidentId: input.incidentId });
  return { ok: true, content: rec.content, meta };
}

async function callLive(
  input: CallInput,
  messages: Parameters<OpenAI['chat']['completions']['create']>[0]['messages'],
  startModel: string | null,
  hash: string,
): Promise<CallResult> {
  const { agent, scenarioId } = input;
  let model = startModel;

  const c = getClient();
  if (!c) return { ok: false, retryable: false, error: 'AMD API key missing on the server' };
  if (!model) return { ok: false, retryable: false, error: `No model available for ${agent}` };

  const choice = MODELS[agent];
  let maxTokens = choice.maxTokens;
  let lengthRetried = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const res = await c.chat.completions.create(
        {
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          ...(() => {
            const effort = model === choice.fallback ? (choice.fallbackReasoningEffort ?? choice.reasoningEffort) : choice.reasoningEffort;
            return effort ? { reasoning_effort: effort } : {};
          })(),
        },
        { timeout: Math.min(choice.timeoutMs ?? CALL_TIMEOUT_MS, Math.max(1000, input.deadline - Date.now() - 2000)) },
      );
      const choice0 = res.choices[0];
      const content = choice0?.message?.content ?? '';
      const meta: CallMeta = {
        agent,
        model,
        latencyMs: Date.now() - t0,
        inTok: res.usage?.prompt_tokens ?? 0,
        outTok: res.usage?.completion_tokens ?? 0,
        replay: false,
      };
      // Reasoning consumed all tokens: one retry with a doubled limit (not counted as an incident call).
      if (!content.trim() && choice0?.finish_reason === 'length' && !lengthRetried) {
        lengthRetried = true;
        maxTokens *= 2;
        log({ ...meta, outcome: 'empty_length_retry', incidentId: input.incidentId });
        attempt--;
        continue;
      }
      log({ ...meta, outcome: 'ok', incidentId: input.incidentId });
      await saveRecording({ agent, scenarioId, hash, model, content, recordedAt: new Date().toISOString() }).catch((e) =>
        console.warn('[llm] could not save recording', errMsg(e)),
      );
      return { ok: true, content, meta };
    } catch (err) {
      const delay = retryDelayMs(err, attempt);
      log({ agent, model, latencyMs: Date.now() - t0, outcome: `error: ${errMsg(err)}`, incidentId: input.incidentId });
      // Primary model repeatedly slow/unavailable: switch to the configured fallback for the remaining attempts.
      if (attempt >= 1 && choice.fallback && model === MODELS[agent].primary && isTransient(err)) {
        const ids = await availableModels();
        if (!ids || ids.has(choice.fallback)) {
          console.warn(`[llm] switching ${agent} to fallback ${choice.fallback}`);
          degradedUntil.set(model, Date.now() + DEGRADED_MS); // later requests start on the fallback
          model = choice.fallback;
        }
      }
      if (delay === null) return { ok: false, retryable: false, error: errMsg(err) };
      if (attempt === MAX_RETRIES) return { ok: false, retryable: false, error: `Retries exhausted: ${errMsg(err)}` };
      if (Date.now() + delay > input.deadline - 3000) {
        // Not enough time left in this serverless invocation: let the browser retry (Req 17.14).
        return { ok: false, retryable: true, retryAfterMs: Math.round(delay), error: errMsg(err) };
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return { ok: false, retryable: false, error: 'Retries exhausted' };
}

/** Extracts the first JSON object from a model response (tolerates code fences / prose). */
export function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const text = (fenced ? fenced[1]! : content).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Invalid JSON: model answer contains no JSON object');
  }
}
