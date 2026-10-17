# FactoryPilot 3D

AI maintenance copilot for manufacturing lines: **from sensor to action, in seconds.**

A navigable 3D map of the factory shows machines in real time. When a sensor goes out of range, FactoryPilot traces the problem **back along the line to the machine that caused it**, diagnoses it citing the **exact page of the technical manual**, prices the incident in **euros**, and either handles minor issues with **safe, reversible actions** or escalates to a human. Every closed repair is stored in a **factory memory** (Evolus RAG) and cited in future diagnoses.

Built for the AMD Developer Hackathon ACT III – track *Intelligent Industry*.

> **Demo data is synthetic** (simulated sensors, cost estimates and sample maintenance history). The manuals for the demo machines are synthetic and labelled as such.

## Who uses it and what it improves

| User | Gets |
| --- | --- |
| Maintenance technician | Root cause, manual page, spare parts, a work order |
| Line operator | A 3D map where problems are visible at a glance |
| Production / maintenance manager | A priority queue in €, approval for risky actions, configurable autonomy |

Measured on the real AMD Token Factory (17 Oct 2026): diagnosis with DeepSeek-V4-Flash in about 8 s without reasoning mode (10–45 s with reasoning enabled, so it is off), Gemma-4-31B-IT safety check in 2–13 s. Slow or failing calls switch automatically to Qwen3.8-Flash-Next.

Measured in the app: time alarm → diagnosis (seconds vs a 45-minute manual-search reference), estimated downtime avoided and savings, incidents handled autonomously vs escalated.

## How it works

```
Browser (deterministic, testable)                    Vercel API routes (keys stay here)
Simulator → Anomaly engine (z-score + thresholds) ─┐
                                                    ├─ Root cause (graph walk upstream)
                                                    ├─ Impact € + priority
                                                    ├─ /api/memory ─────────────► Evolus RAG agent
                                                    ├─ /api/diagnose ───────────► AMD Token Factory · DeepSeek-V4-Flash
                                                    ├─ /api/safety  ────────────► AMD Token Factory · Gemma-4-31B-IT
                                                    └─ Escalation rule (code, final word) → Autonomy L0–L3
```

- **AI only where it matters**: detection, root cause, priority and escalation are pure code; the LLM is called at most 3 times per incident.
- **Safety lives in code**: high risk, low confidence, unverified manual page or a non-whitelisted action ⇒ always a human. Autonomous actions are limited to `riduci_velocita`, `apri_ticket`, `pianifica_ispezione` and can be undone.
- **A factory is a JSON file** (`data/factories/*.json`): machines, sensors, thresholds, links, costs, autonomy levels.

## Run locally

Requires Node ≥ 22.12 (`nvm use`).

```bash
npm install
cp .env.example .env.local   # fill AMD_TOKENFACTORY_APIKEY (and Evolus vars, optional)
npm run dev                  # http://localhost:3000
npm test                     # unit + property-based tests (vitest + fast-check)
```

**New factory in 5 minutes:** *+ New factory* → upload a manual PDF (text extracted in the browser) and a sensor CSV (`machine_id, sensor_name, unit[, machine_name]`, sample in `public/onboarding-sample.csv`) → the AI drafts machines, thresholds, links and 3D layout → edit and confirm.

Demo script: **Start** → choose *Pump P1 bearing wear* → **Inject fault** → watch P1 then F1 turn red, the causal path P1 → F1 light up, the diagnosis cite the pump manual, Gemma rate the risk and the manager approve the work order. Then *Conveyor K1 motor overheating* shows an autonomous L3 action (speed reduced, undoable).

### Replay mode

`REPLAY_MODE=1` (or the *Replay* toggle) serves recorded model responses from `data/replay/` instead of calling the API – a safety net for the video demo, declared as such. Record locally with `RECORD_MODE=1`, then `npx tsx scripts/build-data.ts` and commit `data/replay/`.

## Tech

Next.js 16 · React 19 · TypeScript · React Three Fiber · Zustand · zod · Recharts · Tailwind · OpenAI SDK (AMD Token Factory, Evolus OpenAI-compatible endpoint) · Vitest + fast-check.

## Security notes

API keys are read only server-side (no `NEXT_PUBLIC_`), never sent to the browser or logged; `npm run check:imports` fails the build if client code imports `server/**`. The API routes are **unauthenticated** (demo only): put them behind auth before any real deployment.
