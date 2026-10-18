# FactoryPilot 3D

AI maintenance copilot for manufacturing lines: **from sensor to action, in seconds.**

Two plants run live (Genova: two water bottling lines; Imperia: a juice line): production engineers drill down **plant → line → process cluster → machine**, with OEE, throughput, first pass yield, rejects per station, downtime Paretos and SPC control charts. When a sensor drifts, FactoryPilot traces the problem **back along the line to the machine that caused it**, diagnoses it citing the **exact page of the technical manual**, prices the incident in **euros**, and either handles minor issues with **safe, reversible actions** or escalates to a human. Above the real (ISO / manual) limit the line takes a **protective stop**; closing the repair restarts it. Every closed repair is stored in a **factory memory** and cited in future diagnoses.

On top of that, five AI agents work for the engineers: **Ask FactoryPilot** (questions on the live data, the manuals and the memory, with verified page citations), a **Recovery planner** agent that plans how to win back lost output by end of shift, **visual inspection** of sample bottles for quality holds, the **safety check** of every proposed action, and **onboarding** of a new line from a manual PDF and a sensor CSV.

Built for the AMD Developer Hackathon ACT III – track *Intelligent Industry*.

> **Demo data is synthetic** (simulated sensors, cost estimates and sample maintenance history). The manuals for the demo machines are synthetic and labelled as such.

## Who uses it and what it improves

| User | Gets |
| --- | --- |
| Maintenance technician | Root cause, manual page, spare parts, a work order |
| Line operator | A live 2D/3D twin of the line where problems are visible at a glance |
| Production engineer | Plant and line OEE (A × P × Q), throughput, downtime Pareto, bottleneck, MTBF/MTTR, a recovery plan in € when output is lost, answers to "why is OEE low?" in seconds |
| Quality engineer | FPY, rejects per station, SPC charts with Cpk on product characteristics (fill level, cap torque), quality holds with AI photo sampling and a release / scrap suggestion |
| Production / maintenance manager | Decisions waiting on the plant page, approval for risky actions, configurable autonomy per machine type |

Measured on the real AMD Token Factory (17 Oct 2026): diagnosis with DeepSeek-V4-Flash in about 8 s without reasoning mode (10–45 s with reasoning enabled, so it is off), Gemma-4-31B-IT safety check in 2–13 s. Slow or failing calls switch automatically to Qwen3.8-Flash-Next.

Measured in the app: time alarm → diagnosis (seconds vs a 45-minute manual-search reference), downtime and € lost per line, estimated savings, incidents handled autonomously vs escalated.

## Pages

| Page | What it answers |
| --- | --- |
| **Overview** `/` | How is the plant doing? KPIs, one card per line, OEE over the shift, downtime and reject Paretos, decisions waiting, quality holds, Ask FactoryPilot, Recovery planner |
| **Line / cluster** `/lines/L1`, `/lines/L1/filling` | Where is the line losing output or quality? Line KPIs, clusters with capacity, rejects and bottleneck, live 2D/3D twin, incident and machine panels over the map |
| **Machines** `/machines`, `/machines/P1` | Why does this machine behave like this? Station KPIs, SPC / condition monitoring per sensor (Cpk only where a spec exists, time-to-trip otherwise), 48 h history, its incidents, metrics, configuration, Ask FactoryPilot about this machine |

The plant selector in the header is the global filter. Right-click any machine for its history, details, incidents or to inject its fault.

## The AI agents

| Agent | What it does | Guard rails |
| --- | --- | --- |
| Diagnosis | Root cause, manual page with quote, action code and spare parts for each incident | The quoted page is checked against the manual; unverified ⇒ human |
| Safety check | Rates the risk of the proposed action | High risk ⇒ always a human, whatever the autonomy level |
| Ask FactoryPilot | Answers on the live plant JSON + manual pages and past interventions retrieved for the question (local RAG), in parallel with the **Evolus knowledge library** (RAG over the uploaded manuals and closed interventions) | Sources shown as chips: ✓ only if the page / intervention really was in the retrieved documents |
| Recovery planner | ReAct loop in the browser: calls deterministic tools (`get_situation`, `simulate` repair now / later, boost the other line, overtime) and returns a plan with extra bottles and net € | Numbers come only from the tools; max 6 steps; the plan needs the manager's approval |
| Visual inspection | Gemma looks at photos of sample bottles from a quarantined lot (fill level, cap, label, foreign bodies) | ≥ 3 samples before a suggestion; ≥ 20 % defects ⇒ scrap, all OK ⇒ release; a person decides |
| Onboarding | Drafts machines, sensors, thresholds, links and 3D layout of a new line from a manual and a CSV | zod-validated draft, edited and confirmed by a person |

What happens on the line is deterministic code:

- **Protective stop per line**: a red alarm stops only that line; the other lines keep producing.
- **Bypass**: if the faulty machine has a healthy twin (line 2 has two fillers), the line routes around it and keeps running at 50 % instead of stopping.
- **Quality hold**: bottles made while a product characteristic was out of spec are quarantined as a lot until sampled and released or scrapped.

## How it works

```
Browser (deterministic, testable)                    Vercel API routes (keys stay here)
Simulator → Anomaly engine (z-score warning, ISO trip) ─┐
                                                    ├─ Root cause (graph walk upstream)
                                                    ├─ Impact € + priority
                                                    ├─ /api/diagnose ───────────► AMD Token Factory · DeepSeek-V4-Flash
                                                    ├─ /api/safety  ────────────► AMD Token Factory · Gemma-4-31B-IT
                                                    └─ Escalation rule (code, final word) → Autonomy L0–L2
```

- **AI only where it matters**: detection, root cause, priority, escalation, line stops, bypass and quality holds are pure code; the LLM is called at most 3 times per incident.
- **Safety lives in code**: high risk, low confidence, unverified manual page or a non-whitelisted action ⇒ always a human. Autonomous actions are limited to `riduci_velocita`, `apri_ticket`, `pianifica_ispezione` and can be undone.
- **Yellow = statistical early warning** (|z| > 2.5 for 3 s): it opens the incident while values are still in range. **Red = absolute limit** (ISO 10816 / manual): protective stop of that line only.
- **A line is a JSON file** (`data/factories/*.json`): machines, sensors, thresholds, links, costs, autonomy levels. A plant merges one or more lines (`modules/plant/plant.ts`); sensors are calibrated on public measured data (`data/CALIBRATION.md`).

## Run locally

Requires Node ≥ 22.12 (`nvm use`).

```bash
npm install
cp .env.example .env.local   # fill AMD_TOKENFACTORY_APIKEY (EVOLUS_* optional)
npm run dev                  # http://localhost:3000
npm test                     # unit + property-based tests (vitest + fast-check)
```

**New plant in 5 minutes:** *+ New plant* → upload a manual PDF (text extracted in the browser) and a sensor CSV (`machine_id, sensor_name, unit[, machine_name]`, sample in `public/onboarding-sample.csv`) → the AI drafts machines, thresholds, links and 3D layout → edit and confirm.

Demo script: the plant starts producing on load → **Inject fault** → *L1 · Pump P1 bearing wear* → P1 turns yellow at once (statistical early warning), F1 follows, the causal path P1 → F1 lights up, the diagnosis cites the pump manual and Gemma rates the risk. If nobody acts, P1 crosses the ISO vibration limit after ~70 s and line 1 stops while line 2 keeps producing (protective trip, downtime counter in €, plant OEE drops); closing the approved work order repairs the pump and restarts the line. Then *Conveyor K1 motor overheating* shows an autonomous L2 action (speed reduced, undoable). *L2 · Filler A valve drift* shows the bypass: the twin filler takes over and line 2 keeps running at 50 %. With a line degraded, **Plan recovery with AI** on the Overview runs the Recovery planner; **Ask FactoryPilot** answers "Why is the plant OEE below target?" with figures and manual pages.

**Evolus knowledge library (optional):** upload the manuals and sample interventions to an existing Evolus memory with `npx tsx --env-file=.env.local scripts/evolus-upload-docs.ts` (idempotent). Closed repairs are uploaded automatically.

### Replay mode

`REPLAY_MODE=1` (or the *Replay* toggle) serves recorded model responses from `data/replay/` instead of calling the API – a safety net for the video demo, declared as such. Answers in replay are marked "recorded answer (replay)". Record locally: `npm run build && RECORD_MODE=1 npx next start -p 3130`, then `npx tsx scripts/record-replay.ts http://localhost:3130` (drives the demo flows in Edge/Chromium via playwright-core) and `npx tsx scripts/build-data.ts`; commit `data/replay/`.

On the public URL the shared AMD key is protected: each visitor gets 20 AI calls per minute and each server instance 400 per hour (`RATE_LIMIT_PER_MIN`, `RATE_LIMIT_PER_HOUR`). Over the limit, or if a live call fails for good, the recorded answer for the same scenario is served instead.

## Tech

Next.js 16 · React 19 · TypeScript · React Three Fiber · Zustand · zod · Recharts · Tailwind · OpenAI SDK (AMD Token Factory: DeepSeek-V4-Flash, Gemma-4-31B-IT) · Evolus (RAG) · Vitest + fast-check.

License: MIT.

## Security notes

API keys are read only server-side (no `NEXT_PUBLIC_`), never sent to the browser or logged; `npm run check:imports` fails the build if client code imports `server/**`. The API routes are **unauthenticated** (demo only, rate-limited): put them behind auth before any real deployment.
