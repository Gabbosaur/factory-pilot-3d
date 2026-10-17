# FactoryPilot 3D

AI maintenance copilot for manufacturing lines: **from sensor to action, in seconds.**

A plant with two bottling lines runs live: production engineers drill down **plant → line → process cluster → machine**, with OEE, throughput, first pass yield, rejects per station, downtime Paretos and SPC control charts. When a sensor drifts, FactoryPilot traces the problem **back along the line to the machine that caused it**, diagnoses it citing the **exact page of the technical manual**, prices the incident in **euros**, and either handles minor issues with **safe, reversible actions** or escalates to a human. Above the real (ISO / manual) limit the line takes a **protective stop**; closing the repair restarts it. Every closed repair is stored in a **factory memory** and cited in future diagnoses.

Built for the AMD Developer Hackathon ACT III – track *Intelligent Industry*.

> **Demo data is synthetic** (simulated sensors, cost estimates and sample maintenance history). The manuals for the demo machines are synthetic and labelled as such.

## Who uses it and what it improves

| User | Gets |
| --- | --- |
| Maintenance technician | Root cause, manual page, spare parts, a work order |
| Line operator | A live 2D/3D twin of the line where problems are visible at a glance |
| Production / quality engineer | Plant and line OEE (A × P × Q), FPY, rejects per station, downtime and reject Paretos, bottleneck, SPC charts with Cpk, MTBF/MTTR |
| Production / maintenance manager | Decisions waiting on the plant page, approval for risky actions, configurable autonomy per machine type |

Measured on the real AMD Token Factory (17 Oct 2026): diagnosis with DeepSeek-V4-Flash in about 8 s without reasoning mode (10–45 s with reasoning enabled, so it is off), Gemma-4-31B-IT safety check in 2–13 s. Slow or failing calls switch automatically to Qwen3.8-Flash-Next.

Measured in the app: time alarm → diagnosis (seconds vs a 45-minute manual-search reference), downtime and € lost per line, estimated savings, incidents handled autonomously vs escalated.

## Pages

| Page | What it answers |
| --- | --- |
| **Plant** `/` | How is the plant doing? KPIs, one card per line, OEE over the shift, downtime and reject Paretos, decisions waiting |
| **Line / cluster** `/lines/L1`, `/lines/L1/filling` | Where is the line losing output or quality? Line KPIs, clusters with capacity, rejects and bottleneck, live 2D/3D twin, incident and machine panels over the map |
| **Machine** `/machines/P1` | Why does this machine behave like this? Station KPIs, SPC chart and Cpk per sensor, 48 h history, its incidents, AI impact, configuration |

The plant selector in the header is the global filter. Right-click any machine for its history, details, incidents or to inject its fault.

## How it works

```
Browser (deterministic, testable)                    Vercel API routes (keys stay here)
Simulator → Anomaly engine (z-score warning, ISO trip) ─┐
                                                    ├─ Root cause (graph walk upstream)
                                                    ├─ Impact € + priority
                                                    ├─ /api/diagnose ───────────► AMD Token Factory · DeepSeek-V4-Flash
                                                    ├─ /api/safety  ────────────► AMD Token Factory · Gemma-4-31B-IT
                                                    └─ Escalation rule (code, final word) → Autonomy L0–L3
```

- **AI only where it matters**: detection, root cause, priority and escalation are pure code; the LLM is called at most 3 times per incident.
- **Safety lives in code**: high risk, low confidence, unverified manual page or a non-whitelisted action ⇒ always a human. Autonomous actions are limited to `riduci_velocita`, `apri_ticket`, `pianifica_ispezione` and can be undone.
- **Yellow = statistical early warning** (|z| > 2.5 for 3 s): it opens the incident while values are still in range. **Red = absolute limit** (ISO 10816 / manual): protective stop of that line only.
- **A line is a JSON file** (`data/factories/*.json`): machines, sensors, thresholds, links, costs, autonomy levels. The demo plant merges two lines (`modules/plant/plant.ts`); sensors are calibrated on public measured data (`data/CALIBRATION.md`).

## Run locally

Requires Node ≥ 22.12 (`nvm use`).

```bash
npm install
cp .env.example .env.local   # fill AMD_TOKENFACTORY_APIKEY
npm run dev                  # http://localhost:3000
npm test                     # unit + property-based tests (vitest + fast-check)
```

**New plant in 5 minutes:** *+ New plant* → upload a manual PDF (text extracted in the browser) and a sensor CSV (`machine_id, sensor_name, unit[, machine_name]`, sample in `public/onboarding-sample.csv`) → the AI drafts machines, thresholds, links and 3D layout → edit and confirm.

Demo script: the plant starts producing on load → **Inject fault** → *L1 · Pump P1 bearing wear* → P1 turns yellow at once (statistical early warning), F1 follows, the causal path P1 → F1 lights up, the diagnosis cites the pump manual and Gemma rates the risk. If nobody acts, P1 crosses the ISO vibration limit after ~70 s and line 1 stops while line 2 keeps producing (protective trip, downtime counter in €, plant OEE drops); closing the approved work order repairs the pump and restarts the line. Then *Conveyor K1 motor overheating* shows an autonomous L3 action (speed reduced, undoable).

### Replay mode

`REPLAY_MODE=1` (or the *Replay* toggle) serves recorded model responses from `data/replay/` instead of calling the API – a safety net for the video demo, declared as such. Record locally with `RECORD_MODE=1`, then `npx tsx scripts/build-data.ts` and commit `data/replay/`.

## Tech

Next.js 16 · React 19 · TypeScript · React Three Fiber · Zustand · zod · Recharts · Tailwind · OpenAI SDK (AMD Token Factory) · Vitest + fast-check.

## Security notes

API keys are read only server-side (no `NEXT_PUBLIC_`), never sent to the browser or logged; `npm run check:imports` fails the build if client code imports `server/**`. The API routes are **unauthenticated** (demo only): put them behind auth before any real deployment.
