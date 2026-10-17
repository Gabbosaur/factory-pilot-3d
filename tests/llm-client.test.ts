import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Client_LLM against a mocked fetch (no network). Verifies retry policy, Retry-After,
 * JSON extraction, length-retry and the retryable-deadline contract (Req 17.7, 17.12, 17.14).
 */

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

function mockFetch(replies: Reply[]) {
  const calls: unknown[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.endsWith('/models')) return new Response(JSON.stringify({ object: 'list', data: [{ id: 'DeepSeek-V4-Flash' }, { id: 'Gemma-4-31B-IT' }, { id: 'Qwen3.8-Flash-Next' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    calls.push(init?.body ? JSON.parse(String(init.body)) : null);
    const r = replies.shift() ?? { status: 500, body: { error: { message: 'no more replies' } } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const ok = (content: string, finish = 'stop') => ({
  status: 200,
  body: { id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
});

async function load() {
  vi.resetModules();
  return import('@/server/llm/client');
}

describe('Client_LLM', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    process.env.AMD_TOKENFACTORY_APIKEY = 'rc-test';
    delete process.env.REPLAY_MODE;
    delete process.env.RECORD_MODE;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a 429 honouring Retry-After, then succeeds; sends one system message and no "thinking"', async () => {
    const calls = mockFetch([{ status: 429, body: { error: { message: 'rate' } }, headers: { 'retry-after': '1' } }, ok('{"a":1}')]);
    const { callLLM } = await load();
    const p = callLLM({ agent: 'diagnosi', scenarioId: 's', system: 'S', user: 'U', deadline: Date.now() + 60_000 });
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const body = calls[1] as { messages: Array<{ role: string }>; reasoning_effort?: string; thinking?: unknown };
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.thinking).toBeUndefined();
    // DeepSeek-V4-Flash: omit reasoning_effort so the model does not think (predictable latency).
    expect(body.reasoning_effort).toBeUndefined();
  }, 20_000); // dynamic import + fake-timer flush can be slow under load; keep headroom

  it('Gemma (safety) requests carry no reasoning_effort', async () => {
    const calls = mockFetch([ok('{"livello_rischio":"basso","motivazione":"x"}')]);
    const { callLLM } = await load();
    await callLLM({ agent: 'sicurezza', scenarioId: 's', system: 'S', user: 'U', deadline: Date.now() + 60_000 });
    expect((calls[0] as { reasoning_effort?: string }).reasoning_effort).toBeUndefined();
  });

  it('does not retry a 400 and surfaces nested platform errors {detail:{error}}', async () => {
    const calls = mockFetch([{ status: 400, body: { detail: { error: { message: 'Requested model X not supported' } } } }]);
    const { callLLM } = await load();
    const r = await callLLM({ agent: 'diagnosi', scenarioId: 's', system: 'S', user: 'U', deadline: Date.now() + 60_000 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.retryable).toBe(false);
    expect(!r.ok && r.error).toMatch(/not supported/);
    expect(calls).toHaveLength(1);
  });

  it('returns retryable when the next backoff would exceed the function deadline', async () => {
    mockFetch([{ status: 429, body: { error: { message: 'rate' } }, headers: { 'retry-after': '60' } }]);
    const { callLLM } = await load();
    const r = await callLLM({ agent: 'diagnosi', scenarioId: 's', system: 'S', user: 'U', deadline: Date.now() + 10_000 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.retryable).toBe(true);
    expect(!r.ok && r.retryAfterMs).toBe(60_000);
  });

  it('empty content with finish_reason=length triggers one retry with more tokens', async () => {
    const calls = mockFetch([ok('', 'length'), ok('{"a":1}')]);
    const { callLLM } = await load();
    const r = await callLLM({ agent: 'diagnosi', scenarioId: 's', system: 'S', user: 'U', deadline: Date.now() + 60_000 });
    expect(r.ok).toBe(true);
    expect((calls[1] as { max_tokens: number }).max_tokens).toBe(2 * (calls[0] as { max_tokens: number }).max_tokens);
  });

  it('switches to the fallback model after repeated transient errors', async () => {
    const calls = mockFetch([
      { status: 503, body: { error: { message: 'busy' } } },
      { status: 503, body: { error: { message: 'busy' } } },
      ok('{"a":1}'),
    ]);
    const { callLLM, MODELS } = await load();
    const p = callLLM({ agent: 'diagnosi', scenarioId: 's', system: 'S', user: 'U', deadline: Date.now() + 60_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(r.ok).toBe(true);
    expect((calls[0] as { model: string }).model).toBe(MODELS.diagnosi.primary);
    expect((calls[2] as { model: string }).model).toBe(MODELS.diagnosi.fallback);
    expect((calls[2] as { reasoning_effort?: string }).reasoning_effort).toBe('none');
  });

  it('extractJson tolerates code fences and surrounding prose', async () => {
    const { extractJson } = await load();
    expect(extractJson('```json\n{"x":1}\n```')).toEqual({ x: 1 });
    expect(extractJson('Ecco: {"x":2} fine')).toEqual({ x: 2 });
    expect(() => extractJson('niente')).toThrow();
  });
});
