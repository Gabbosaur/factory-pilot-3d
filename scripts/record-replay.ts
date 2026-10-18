/**
 * Records live AMD answers for the demo flows by driving the app in a real browser, so Replay covers them:
 * Ask FactoryPilot example questions (both plants, a machine page) and the Recovery planner agent
 * (all lines running, a protective stop, a bypass). Recordings land in data/replay/ (RECORD_MODE=1 server).
 *
 * Run against a dev server started with RECORD_MODE=1, e.g.
 *   RECORD_MODE=1 npx next dev -p 3130      then
 *   npx tsx scripts/record-replay.ts http://localhost:3130 [path-to-chromium-or-edge]
 *   npx tsx scripts/build-data.ts
 * Needs playwright-core (npm i --no-save playwright-core). Uses the installed Edge by default.
 */
import { chromium, type Page } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://localhost:3130';
const EXE = process.argv[3] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function askExamples(page: Page, label: string) {
  if (process.env.AGENTS_ONLY === '1') return; // re-record only the Recovery planner runs
  const panel = page.locator('section[aria-label="Ask FactoryPilot"]').first();
  const chips = panel.locator(':scope > div.mt-2 > div > button');
  const n = await chips.count();
  for (let i = 0; i < n; i++) {
    const q = (await chips.nth(i).innerText()).trim();
    await chips.nth(i).click();
    await page.waitForTimeout(500);
    // The chips are disabled while the AMD answer is pending; the Evolus section may still be loading after.
    await page.keyboard.press('Escape');
    await page.waitForFunction((el) => !(el as HTMLButtonElement).disabled, await chips.nth(i).elementHandle(), { timeout: 180_000 });
    const text = (await panel.locator('dialog').textContent()) ?? '';
    log(label, ok(text) ? 'ok ' : 'ERR', q);
  }
}

const ok = (text: string) => /live on AMD/.test(text);

async function runAgent(page: Page, label: string) {
  const btn = page.getByRole('button', { name: /Plan recovery with AI|Planning…/ });
  await btn.click();
  await page.getByRole('button', { name: 'Plan recovery with AI' }).waitFor({ timeout: 240_000 });
  const approve = await page.getByRole('button', { name: /Approve plan/ }).count();
  log(label, approve ? 'plan ready' : 'NO PLAN (see the panel error)');
  if (approve) await page.getByRole('button', { name: 'Discard' }).click();
}

async function injectFault(page: Page, labelPart: string) {
  await page.getByRole('button', { name: /Simulate fault/ }).click();
  await page.getByRole('menuitem').filter({ hasText: labelPart }).first().click();
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(8000); // let the shift accumulate some production

  // 1) Overview of every plant: example questions + agent with all lines running.
  const plants = await page.locator('header select option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  for (const id of plants) {
    await page.locator('header select').selectOption(id);
    await page.waitForTimeout(6000);
    await askExamples(page, `ask plant ${id}`);
    await runAgent(page, `agent ${id} all-running`);
  }
  await page.locator('header select').selectOption(plants[0]!);
  await page.waitForTimeout(4000);

  // 2) Machine page examples.
  await page.goto(`${BASE}/machines/P1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  await askExamples(page, 'ask machine P1');

  // 3) Bypass on line 2 (twin filler takes over), then the agent.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await injectFault(page, 'Filler A valve drift');
  await page.getByText(/bypass/i).first().waitFor({ timeout: 180_000 }).catch(() => log('bypass not seen'));
  await page.waitForTimeout(3000);
  await runAgent(page, 'agent bypass');
  await askExamples(page, 'ask plant (bypass)');

  // 4) Protective stop of line 1 (P1 bearing crosses the ISO limit after ~70 s), then the agent.
  await injectFault(page, 'L1 · Pump P1 bearing');
  await page.getByText(/stopped/i).first().waitFor({ timeout: 240_000 }).catch(() => log('stop not seen'));
  await page.waitForTimeout(3000);
  await runAgent(page, 'agent line stop');
  await askExamples(page, 'ask plant (stop)');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
