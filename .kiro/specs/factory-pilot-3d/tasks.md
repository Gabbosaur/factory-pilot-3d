# Piano di Implementazione

Legenda: **[A]** = Persona A (Monitoraggio), **[B]** = Persona B (Incidenti), **[AB]** = insieme. I task con `*` sono opzionali. Ordine = priorità (P0 → P5, vedi design).

Stato al 17/10 pomeriggio: P0–P2 implementati e verificati (test + smoke end-to-end reale su AMD Token Factory). Restano Evolus (setup), onboarding, deploy.

- [x] 0. Setup comune [AB]
  - [x] 0.1 Node 22 (nvm, `.nvmrc`), Next.js 16 + TS strict + Tailwind 4, dipendenze con versioni fissate
  - [x] 0.2 `shared/schemas.ts` (zod, fonte unica) + `shared/types.ts`
  - [x] 0.3 Test round-trip Diagnosi
  - [x] 0.4 Guardia import `scripts/check-imports.ts` (eseguita in `prebuild`)

- [x] 1. Configurazione fabbrica e dati demo [A]
  - [x] 1.1 Parser + serializzatore (schema, riferimenti, simmetria, duplicati, cicli, riga/colonna)
  - [x] 1.2 Test round-trip e configurazioni non valide
  - [x] 1.3 `bottling-line.json` (P1→F1→C1→K1) e `bottling-line-twin.json` (doppia riempitrice)
  - [ ] 1.4 Sostituire `data/manuals/pump-p1.md` (sintetico) con il manuale reale della pompa, poi `npx tsx scripts/build-data.ts`

- [x] 2. Simulatore e Motore_Anomalie [A]
  - [x] 2.1–2.5 Simulatore deterministico con cascata, motore z-score + soglie, store con loop resistente al background

- [x] 3. Checkpoint A superato (test scenario A: P1 rossa prima di F1)

- [x] 4. Client LLM e API route [B]
  - [x] 4.1 `server/llm/client.ts` (modelli verificati, fallback, backoff, errori annidati, length retry, deadline → retryable)
  - [x] 4.2 Replay (registrazione locale, indice statico) – `scripts/build-data.ts`
  - [x] 4.3 `/api/diagnose`, `/api/safety`, `/api/health`, `/api/memory`
  - [x] 4.4 Test Client_LLM con fetch mockato (`tests/llm-client.test.ts`: 429+Retry-After, 400 annidato, deadline→retryable, length, Gemma senza reasoning_effort)

- [x] 5. Logica incidenti pura [B] (manual, escalation, rootCause, impact) con test di proprietà 5, 8, 10, 11

- [x] 6. Orchestratore_Incidenti [B] (coda 4/20, max 3 chiamate, pipeline completa, tempo allarme→diagnosi)

- [x] 7. Checkpoint B superato: `scripts/e2e-smoke.ts` su API reali
  - Scenario A: F1 in allarme → causa P1, diagnosi DeepSeek 16 s con pag. 6 verificata, Gemma rischio alto → escalation
  - Scenario B: K1 → diagnosi 10 s, Gemma rischio basso

- [x] 8. Integrazione [AB] – allarmi collegati all'orchestratore nella Dashboard
  - [x] 8.1 Registrare le risposte per il replay: `bash scripts/record-demo.sh` (build, server con RECORD_MODE, smoke A e B, indice)

- [x] 9. Interfaccia monitoraggio [A] (mappa 3D low-poly, percorso causale animato, bottiglie, elenco accessibile, dettaglio con grafici, barra comandi)

- [x] 10. Interfaccia incidenti [B] (card, coda, ordine di lavoro, chiusura, metriche)

- [ ] 11. Checkpoint demo P0+P1: provare scenario A e B nel browser (`npm run dev`)

- [x] 12. Autonomia e memoria [B]
  - [x] 12.1 Gestore_Autonomia, esecuzione `riduci_velocita` sul simulatore, notifica, annullamento
  - [x] 12.2 Test proprietà autonomia limitata
  - [x] 12.3 LocalMemory + seed + "Ripristina demo"
  - [x] 12.4 Test filtro memoria
  - [x] 12.5 Editor livelli di autonomia in UI (`AutonomyEditor`)

- [ ] 13. Evolus [B]
  - [ ] 13.1 Eseguire `npx tsx --env-file=.env scripts/evolus-setup.ts` e aggiungere `EVOLUS_MEMORY_AGENT_ID`, `EVOLUS_MEMORY_ID` a `.env` e Vercel
  - [x] 13.2 `server/evolus.ts` (search via chat completions, save via upload, delete)
  - [x] 13.3 `/api/memory` + adattatore con fallback locale e scrittura duale

- [ ] 14. Seconda fabbrica e onboarding [A]
  - [x] 14.1 Seconda configurazione
  - [x] 14.2 Pagina onboarding (`/onboarding`): PDF → testo nel browser (pdf.js da CDN), CSV parser, `/api/onboard` con validazione + 1 ritentativo, editor soglie/collegamenti, attivazione (localStorage)
  - [ ] 14.3 Provare onboarding dal vivo con `public/onboarding-sample.csv`

- [ ] 15. Deploy e consegna [AB]
  - [ ] 15.1 Vercel: import repo, variabili d'ambiente, verifica `/api/health`
  - [x] 15.2 README
  - [ ] 15.3 Video, slide, scheda lablab.ai

- [ ]* 16. Opzionali (foto Gemma, nota vocale MiMo, benchmark)
