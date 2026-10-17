# Piano di Implementazione

Legenda: **[A]** = Persona A (Monitoraggio), **[B]** = Persona B (Incidenti), **[AB]** = insieme. I task con `*` sono opzionali. Ordine = priorità (P0 → P5, vedi design).

- [ ] 0. Setup comune [AB]
  - [ ] 0.1 Aggiornare Node a ≥ 20 in locale; scaffold Next.js 15 + TS strict + Tailwind; installare dipendenze con versioni fissate (three, @react-three/fiber, @react-three/drei, zustand, zod, recharts, openai, papaparse, pdfjs-dist, vitest, fast-check, tsx)
    - Verificare che `.gitignore` escluda `.env*`; creare `.env.local` da `.env.example`
    - _Requisiti: 17.2, 17.3_
  - [ ] 0.2 Scrivere `shared/types.ts` e `shared/schemas.ts` (Alarm, Sample, Diagnosis, RiskAssessment, Incident, MemoryEntry, FactoryConfig)
    - _Requisiti: 1.1, 4.1, 8.2, 9.1_
  - [ ]* 0.3 Test di proprietà round-trip Alarm e Diagnosi
    - **Proprietà 3, 4** – _Requisiti: 4.3, 8.6_
  - [ ] 0.4 Regola ESLint `no-restricted-imports` che vieta `server/**` da `modules/**` e `shared/**`
    - _Requisiti: 17.3_

- [ ] 1. Configurazione fabbrica e dati demo [A]
  - [ ] 1.1 Parser_Configurazione + serializzatore (schema zod, riferimenti, duplicati, cicli, errori con percorso e riga/colonna)
    - _Requisiti: 1.2–1.7, 1.9, 1.10_
  - [ ]* 1.2 Test di proprietà round-trip e configurazioni non valide
    - **Proprietà 1, 2** – _Requisiti: 1.4, 1.5, 1.7, 1.10_
  - [ ] 1.3 Creare `data/factories/bottling-line.json` (P1→F1→C1→L1→K1, guasti scenario A e B, autonomia K1 L3 su `riduci_velocita`)
    - _Requisiti: 1.8, 2.3, 2.4, 10.1_
  - [ ] 1.4 Scaricare il manuale pubblico della pompa, `scripts/extract-manual.ts` → `data/manuals/pump-p1.md`; scrivere manuali sintetici brevi per F1, C1, L1, K1
    - _Requisiti: 7.1–7.3, 7.6, 7.7_

- [ ] 2. Simulatore e Motore_Anomalie [A]
  - [ ] 2.1 Simulatore con PRNG `mulberry32`, tick 1 s, guasti locali e a cascata (ritardo 8 s per salto), Ripristina, rifiuto guasti non validi
    - _Requisiti: 2.1–2.5, 2.7–2.9_
  - [ ]* 2.2 Test di proprietà determinismo simulatore
    - **Proprietà 7** – _Requisiti: 2.7_
  - [ ] 2.3 Motore_Anomalie: buffer 60, z-score incrementale, soglie fisse, giallo/rosso/verde, aggiornamento Allarme esistente, scarto campioni non validi
    - _Requisiti: 3.1–3.10, 4.2, 4.6_
  - [ ]* 2.4 Test di proprietà invariante del verde
    - **Proprietà 6** – _Requisiti: 3.7_
  - [ ] 2.5 Store Zustand (slice monitoring) + loop di tick resistente al background
    - _Requisiti: 4.4, 4.5_

- [ ] 3. Checkpoint A: simulazione e allarmi visibili in console con scenario A e B. Chiedere all'utente se ci sono dubbi.

- [ ] 4. Client LLM e API route [B]
  - [ ] 4.1 `server/llm/client.ts`: OpenAI SDK su Token Factory, modelli per ruolo con fallback via `/v1/models` (cache 10 min), backoff 429/5xx con `Retry-After` e jitter, gestione `finish_reason: length`, errori `{error}`/`{detail:{error}}`, log senza segreti
    - _Requisiti: 17.1, 17.4–17.9, 17.11–17.14_
  - [ ] 4.2 Replay: registrazione locale (`RECORD_MODE`), lettura da indice statico, fallback per agente+scenario, `scripts/build-replay-index.ts`
    - _Requisiti: 18.1–18.3, 18.5–18.8, 17.13_
  - [ ] 4.3 Route `/api/diagnose`, `/api/safety`, `/api/health` con validazione zod, `runtime = 'nodejs'`, `maxDuration`
    - _Requisiti: 8.2, 9.1, 17.10, 17.14_
  - [ ]* 4.4 Test della route con fetch mockato (429 + Retry-After, JSON malformato, length, errore annidato)
    - _Requisiti: 8.3, 17.7, 17.12_

- [ ] 5. Logica incidenti pura [B]
  - [ ] 5.1 `manual.ts`: parsePages/renderPages, selezione pagine rilevanti (max 12), verifyCitation
    - _Requisiti: 7.4, 7.8, 8.5_
  - [ ]* 5.2 Test di proprietà round-trip manuale
    - **Proprietà 5** – _Requisiti: 7.5_
  - [ ] 5.3 `escalation.ts` con elenco motivi
    - _Requisiti: 9.2–9.5, 9.7, 9.8_
  - [ ]* 5.4 Test di proprietà invariante di sicurezza
    - **Proprietà 8** – _Requisiti: 9.5_
  - [ ] 5.5 `rootCause.ts` (BFS, tie-break, timeout 1 s)
    - _Requisiti: 12.1–12.6, 12.10_
  - [ ]* 5.6 Test di proprietà percorso causale valido
    - **Proprietà 10** – _Requisiti: 12.3_
  - [ ] 5.7 `impact.ts` (insieme macchine, costo, pezzi = max, risparmio, priorità monotona)
    - _Requisiti: 13.1–13.4, 13.7_
  - [ ]* 5.8 Test di proprietà priorità monotona
    - **Proprietà 11** – _Requisiti: 13.3, 13.4_

- [ ] 6. Orchestratore_Incidenti [B]
  - [ ] 6.1 Coda FIFO (4 concorrenti, 20/60 s), limite 3 chiamate per incidente, riaccodamento `retryable`
    - _Requisiti: 8.7, 8.8, 17.6, 17.14_
  - [ ] 6.2 Pipeline: Alarm → Incidente → rootCause → impact provvisorio → memoria → diagnose → verifyCitation → safety → ricalcolo priorità → escalation; tempo allarme→diagnosi
    - _Requisiti: 8.1, 8.3, 8.4, 9.6, 12.9, 13.8, 14.1_

- [ ] 7. Checkpoint B: con un `Alarm` finto scritto a mano, la pipeline produce diagnosi ed escalation (anche in replay). Chiedere all'utente se ci sono dubbi.

- [ ] 8. Integrazione [AB]
  - [ ] 8.1 Collegare gli Allarmi del Motore_Anomalie all'Orchestratore; registrare le risposte reali di scenario A e B con `RECORD_MODE=1`
    - _Requisiti: 4.2, 18.1_

- [ ] 9. Interfaccia monitoraggio [A]
  - [ ] 9.1 Mappa_3D: macchine low-poly, collegamenti, colori di stato, OrbitControls limitati, selezione, fallback WebGL, indicatore pausa
    - _Requisiti: 5.1–5.6, 5.8–5.10_
  - [ ] 9.2 Percorso_Causale evidenziato e animato sulla mappa
    - _Requisiti: 12.7, 12.8_
  - [ ] 9.3 Elenco macchine accessibile (tastiera, aria-live) e pannello dettaglio con grafici 60 s e soglie
    - _Requisiti: 5.7, 6.1–6.8_
  - [ ] 9.4 Barra comandi: selettore fabbrica, Inietta guasto, Ripristina, interruttore Replay, etichetta "Dati sintetici", badge stato AI/memoria
    - _Requisiti: 1.11, 2.3, 2.5, 2.6, 18.4, 18.6_

- [ ] 10. Interfaccia incidenti [B]
  - [ ] 10.1 Card incidente: diagnosi con pagina citata e badge non verificata, rischio, impatto in euro con etichetta "stima", interventi simili, registro
    - _Requisiti: 8.9, 8.10, 13.6, 15.3, 15.7_
  - [ ] 10.2 Coda di approvazione ordinata per priorità, approva/rifiuta con validazione, generazione Ordine_di_Lavoro, chiusura con causa/intervento/durata
    - _Requisiti: 11.1–11.7, 13.5_
  - [ ] 10.3 Pannello_Metriche
    - _Requisiti: 14.2–14.7_

- [ ] 11. Checkpoint demo P0+P1: scenario A completo dal vivo e in replay. Chiedere all'utente se ci sono dubbi.

- [ ] 12. Autonomia e memoria [B]
  - [ ] 12.1 `autonomy.ts` (L0–L3, whitelist, L3 con escalation → L2), esecuzione `riduci_velocita` sul simulatore, notifica, annullamento con snapshot, editor livelli
    - _Requisiti: 10.1–10.12_
  - [ ]* 12.2 Test di proprietà autonomia limitata
    - **Proprietà 9** – _Requisiti: 10.5, 10.6_
  - [ ] 12.3 Adattatore_Memoria con `LocalMemory` (seed, save, reset "Ripristina demo"), filtro esatto
    - _Requisiti: 15.1, 15.2, 15.4–15.6, 15.8, 15.9_
  - [ ]* 12.4 Test di proprietà filtro memoria
    - **Proprietà 12** – _Requisiti: 15.2_

- [ ] 13. Evolus [B]
  - [ ] 13.1 Setup Evolus: ottenere Application ID; creare memoria Rag (portale o User API Key), agente memoria, assegnazione; `scripts/evolus-setup.ts` carica seed interventi (md con front-matter), schede macchina e manuale pompa
    - _Requisiti: 15.5, 15.10_
  - [ ] 13.2 `server/evolus.ts`: `search` via `/v1/chat/completions` (model `{appId}:{agentId}`, parse+zod del JSON), `save` via upload documento, `reset` dei documenti non-seed; backoff 429, 402 → fallback
    - _Requisiti: 15.10, 15.11_
  - [ ] 13.3 `/api/memory` + `EvolusMemory` (timeout 5 s, scrittura duale con LocalMemory, unione risultati dedup per id, filtro esatto)
    - _Requisiti: 15.1, 15.2, 15.4, 15.11_

- [ ] 14. Seconda fabbrica e onboarding [A]
  - [ ] 14.1 `data/factories/machining-cell.json` + manuali sintetici
    - _Requisiti: 1.8_
  - [ ] 14.2 Pagina onboarding: PDF (pdfjs nel browser) + CSV (papaparse), `/api/onboard`, validazione con un ritentativo, editor bozza, conferma
    - _Requisiti: 16.1–16.10_

- [ ] 15. Deploy e consegna [AB]
  - [ ] 15.1 Deploy su Vercel con variabili d'ambiente (senza `NEXT_PUBLIC_`), verifica `/api/health`, prova scenari A e B sull'URL pubblico
    - _Requisiti: 17.2, 17.3_
  - [ ] 15.2 README (setup, architettura, dati sintetici, modelli AMD usati, replay dichiarato), video, slide, scheda lablab.ai

- [ ]* 16. Opzionali [A/B]
  - [ ]* 16.1 Ispezione foto con Gemma – _Requisiti: 19.1–19.6_
  - [ ]* 16.2 Nota vocale con MiMo – _Requisiti: 20.1–20.5_
  - [ ]* 16.3 Pagina benchmark – _Requisiti: 21.1–21.4_
