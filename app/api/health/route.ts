/**
 * GET /api/health – reports which integrations are configured, never their values.
 */
import { NextResponse } from 'next/server';
import { availableModels, hasApiKey, MODELS } from '@/server/llm/client';
import { isReplayDefault } from '@/server/llm/replay';
import { evolusConfigured } from '@/server/evolus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ids = hasApiKey() ? await availableModels() : null;
  return NextResponse.json({
    amdKey: hasApiKey(),
    evolus: evolusConfigured(),
    replayDefault: isReplayDefault(),
    models: Object.fromEntries(
      Object.entries(MODELS).map(([agent, m]) => [agent, { primary: m.primary, available: ids ? ids.has(m.primary) : null }]),
    ),
  });
}
