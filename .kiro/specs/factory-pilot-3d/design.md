# Documento di Design – FactoryPilot 3D

## Panoramica

FactoryPilot 3D è un'unica applicazione Next.js (App Router, TypeScript) ospitata su Vercel. Tutta la logica deterministica (simulazione, rilevamento, causa radice, impatto, escalation, autonomia) gira nel browser. Il server espone solo API route sottili che custodiscono le chiavi e parlano con AMD Token Factory e con Evolus.

Principi guida:
- **L'AI decide solo dove serve.** Rilevamento, causa radice, priorità ed escalation sono codice puro e testabile. L'LLM produce solo diagnosi e valutazione del rischio, al massimo 3 chiamate per incidente.
- **La sicurezza sta nel codice.** La Regola_Escalation e il Gestore_Autonomia sono funzioni pure che hanno sempre l'ultima parola.
- **Funziona anche senza rete.** Senza chiave, senza Evolus o con API in 429, la demo prosegue in Modalità_Replay e con memoria locale.
- **Una fabbrica è un file JSON.** Cambiando configurazione cambiano mappa, simulazione, soglie e costi.

## Architettura

```mermaid
flowchart LR
  subgraph Browser
    SIM[Simulatore<br/>PRNG con seme] --> AE[Motore_Anomalie<br/>z-score + soglie]
    AE -->|Alarm| ORC[Orchestratore_Incidenti]
    ORC --> RCA[Analizzatore_Causa_Radice]
    ORC --> IMP[Calcolatore_Impatto]
    ORC --> ESC[Regola_Escalation]
    ESC --> AUT[Gestore_Autonomia]
    STORE[(Store Zustand<br/>Flusso_Eventi)]
    SIM & AE & ORC & AUT --> STORE
    STORE --> UI[Mappa_3D R3F<br/>Pannelli, Coda, Metriche]
  end
  subgraph Vercel API routes - Node runtime
    D[/api/diagnose/]
    S[/api/safety/]
    O[/api/onboard/]
    M[/api/memory/]
    LLM[Client_LLM<br/>backoff, replay, log]
  end
  ORC -->|fetch, coda 4 conc / 20 rpm| D & S
  ORC --> M
  D & S & O --> LLM --> TF[(AMD Token Factory)]
  M --> EV[(Evolus RAG)]
  LLM -.replay.-> RJ[(data/replay/*.json)]
```

Flusso di un incidente:
1. Il Simulatore emette un Campione al secondo per sensore e lo passa al Motore_Anomalie.
2. Il Motore_Anomalie aggiorna lo Stato_Macchina. Su soglia critica emette un `Alarm` validato con zod.
3. L'Orchestratore crea l'Incidente oppure lo aggiorna se esiste già un incidente aperto sulla stessa macchina e sensore.
4. In modo sincrono e nel browser, l'Orchestratore calcola il Percorso_Causale e poi l'impatto provvisorio, con rischio considerato `alto`.
5. In parallelo recupera dalla Memoria_Fabbrica fino a 3 interventi simili: Evolus, con fallback locale.
6. Chiama `/api/diagnose` con l'Allarme, il Percorso_Causale, le pagine del manuale della macchina causa radice e gli interventi simili. Risposta: `Diagnosi`.
7. Valida la citazione rispetto alle pagine del manuale. Se la pagina non esiste, la confidenza diventa 0.
8. Chiama `/api/safety` con Diagnosi e contesto. Risposta: `ValutazioneRischio`.
9. Ricalcola la priorità, poi la Regola_Escalation decide. Se c'è escalation, l'incidente va in coda. Altrimenti decide il Gestore_Autonomia in base al livello L0–L3.
10. Dopo l'approvazione nasce l'Ordine_di_Lavoro. Alla chiusura l'intervento viene salvato nella Memoria_Fabbrica.

## Stack e librerie

| Esigenza | Scelta |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript strict |
| Node | ≥ 20 (in locale c'è Node 18.19: va aggiornato, Next 15 richiede ≥ 18.18 ma Vercel usa 20/22) |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei` (OrbitControls, Line, Html), caricati con `dynamic(..., { ssr: false })` |
| Stato | `zustand` |
| Validazione | `zod` (configurazione, Alarm, Diagnosi, ValutazioneRischio, richieste API) |
| Grafici | `recharts` |
| UI | Tailwind CSS |
| LLM | `openai` SDK con `baseURL` del Token Factory |
| PDF onboarding (browser) | `pdfjs-dist` |
| CSV | `papaparse` |
| Test | `vitest` + `fast-check` |
| Estrazione manuale (script) | `tsx scripts/extract-manual.ts`, con `unpdf` per i PDF testuali e `/v1/ocr` (MinerU2.5-Pro) come alternativa |

Le versioni esatte vanno fissate nel `package.json` al momento dello scaffolding.

## Struttura del repository

```
app/
  page.tsx                  shell: Mappa_3D + elenco macchine + pannelli
  approvals/page.tsx        coda di approvazione (vista Responsabile)
  onboarding/page.tsx       Modulo_Onboarding
  benchmark/page.tsx        (opzionale)
  api/diagnose/route.ts     Agente_Diagnosi
  api/safety/route.ts       Agente_Sicurezza
  api/onboard/route.ts      generazione configurazione
  api/memory/route.ts       proxy Evolus (search, upsert)
  api/health/route.ts       stato chiavi/modelli senza esporre valori
shared/
  types.ts                  contratti: Alarm, Sample, MachineState, Incident...
  schemas.ts                schemi zod corrispondenti
modules/monitoring/         PERSONA A
  config/parser.ts          Parser_Configurazione + serializzatore
  simulator/                Simulatore, PRNG mulberry32, fault profiles
  anomaly/engine.ts         Motore_Anomalie
  map3d/                    componenti R3F
  panels/                   dettaglio macchina, grafici
  store.ts                  slice monitoring dello store
modules/incidents/          PERSONA B
  orchestrator.ts           Orchestratore_Incidenti + coda richieste
  rootCause.ts              Analizzatore_Causa_Radice
  impact.ts                 Calcolatore_Impatto
  escalation.ts             Regola_Escalation
  autonomy.ts               Gestore_Autonomia
  memory/                   Adattatore_Memoria (evolus.ts, local.ts)
  manual.ts                 parse marcatori <!-- page: N -->
  ui/                       coda, card incidente, ordine di lavoro, metriche
server/
  llm/client.ts             Client_LLM (solo server)
  llm/prompts.ts            prompt di diagnosi e sicurezza
  llm/replay.ts             registrazione / riproduzione
  evolus.ts                 client Evolus (solo server)
data/
  factories/bottling-line.json
  factories/machining-cell.json
  manuals/*.md              Manuale_Markdown estratti
  memory-seed.json          interventi di esempio
  replay/*.json             risposte registrate
scripts/extract-manual.ts
tests/                      vitest + fast-check
```

Regola d'import: `modules/**` e `shared/**` non importano mai da `server/**`, e un controllo ESLint lo vieta. Così le chiavi non finiscono nel bundle client.

## Componenti e interfacce

### Contratti condivisi (`shared/types.ts`), da scrivere insieme nei primi 20 minuti

```ts
export type MachineStatus = 'verde' | 'giallo' | 'rosso';
export type RiskLevel = 'basso' | 'medio' | 'alto';
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type ActionCode = 'riduci_velocita' | 'apri_ticket' | 'pianifica_ispezione' | 'intervento_manutentivo';
export const WHITELIST: readonly ActionCode[] = ['riduci_velocita', 'apri_ticket', 'pianifica_ispezione'];

export interface Sample { machineId: string; sensorId: string; value: number; ts: number /* epoch ms */; }

export interface Alarm {
  id: string;
  machineId: string;
  sensorId: string;
  value: number;
  zScore: number;
  threshold: number;          // soglia superata (fissa o z)
  severity: 'giallo' | 'rosso';
  openedAt: string;           // ISO 8601 con fuso
  window: Sample[];           // 1..60, ts crescente, stesso sensore
}

export interface Diagnosis {
  causa_probabile: string;
  pagina_manuale: number;     // >= 1
  citazione: string;
  confidenza: number;         // 0..1
  azione_raccomandata: string;
  codice_azione: ActionCode;
  ricambi: string[];
  citazione_verificata?: boolean;   // impostato dal client, non dal modello
}

export interface RiskAssessment { livello_rischio: RiskLevel; motivazione: string; }

export interface Impact { costPerMin: number; partsAtRiskPerMin: number; savingsEur: number; horizonMin: number; }

export interface EscalationDecision { escalate: boolean; reasons: EscalationReason[]; }
export type EscalationReason = 'rischio_alto' | 'confidenza_bassa' | 'diagnosi_non_disponibile' | 'azione_non_whitelist';

export interface Incident {
  id: string;
  machineId: string;              // macchina in allarme
  alarmIds: string[];
  sensorIds: string[];
  createdAt: string;
  status: 'analisi' | 'in_coda' | 'autonomo' | 'approvato' | 'rifiutato' | 'chiuso';
  causalPath: string[];           // [causa radice, ..., machineId]
  rootCauseComplete: boolean;
  impact: Impact;
  priority: number;
  diagnosis: Diagnosis | null | 'non_disponibile';
  risk: RiskAssessment | null;
  escalation: EscalationDecision | null;
  autonomyLevel: AutonomyLevel;   // congelato alla creazione (Req 10.9)
  similar: MemoryEntry[];
  log: IncidentLogEntry[];
  llmCalls: number;               // <= 3 (Req 8.7)
  alarmToDiagnosisSec?: number;
  workOrder?: WorkOrder;
}

export interface MemoryEntry {
  id: string; machineId: string; machineType: string; sensorIds: string[];
  realCause: string; fix: string; durationMin: number; closedAt: string; isSample: boolean;
}
```

Ogni tipo ha lo schema zod gemello in `shared/schemas.ts`. Validazione e round-trip si testano sugli schemi.

### Configurazione_Fabbrica (estratto dello schema)

```ts
interface FactoryConfig {
  id: string; name: string;
  manualSearchRefSec?: number;          // tempo di ricerca manuale di riferimento (Req 14)
  impactHorizonMin: number;             // default 60
  confidenceThreshold: number;          // default 0.7
  zThresholds: { warn: number; crit: number };   // default 2.5 / 3.5
  autonomy: Record<string /* machineType */, Partial<Record<ActionCode, AutonomyLevel>>>;
  machines: Array<{
    id: string; name: string; type: string;
    position: [number, number, number]; size: [number, number, number];
    upstream: string[]; downstream: string[];
    downtimeCostPerMin: number; partsPerMin: number; manualRef: string;
    sensors: Array<{ id: string; name: string; unit: string;
      nominal: [number, number]; warn: number; crit: number; noise: number }>;
  }>;
  faults: Array<{ id: string; label: string; machineId: string; kind: 'locale' | 'cascata';
    effects: Array<{ sensorId: string; ratePerSec: number }>; }>;
}
```

Il parser verifica, oltre allo schema, la coerenza tra `upstream` e `downstream`, i riferimenti esistenti, l'unicità degli id e l'assenza di cicli (DFS con colori).

### Modulo Monitoraggio (Persona A)

- **Simulatore.** Usa `mulberry32(seed)`. Ogni tick vale 1000 ms (`setInterval`, riallineato con `performance.now()` per resistere al throttling delle schede in background). Il valore è nominale + rumore uniforme limitato all'intervallo nominale (Req 2.2) + deriva del guasto: `effetto.ratePerSec × secondi dall'inizio`. Nei guasti a cascata il ritardo per ogni salto vale `8 s` (Req 2.4 chiede 5–30 s). Per il determinismo dei comandi, guasto e reset vengono applicati all'indice di tick e non al tempo reale.
- **Motore_Anomalie.** Ha un buffer circolare di 60 valori per sensore con media e varianza aggiornate in modo incrementale. Se il buffer ha meno di 60 valori o σ = 0, si usano solo le soglie fisse (Req 3.8). Il ritorno al verde avviene dopo 10 campioni puliti consecutivi su tutti i sensori. I campioni anomali non entrano nel buffer di riferimento: così la deriva non "normalizza" sé stessa e lo z-score resta significativo.
- **Mappa_3D.** Ogni macchina è un gruppo di box e cilindri con colore di stato ed `emissive` pulsante quando è rossa. I collegamenti sono `drei/Line` tra i centri. Il Percorso_Causale è una linea più spessa e animata (dash offset) dalla causa radice al sintomo. Si usano `OrbitControls` con `maxPolarAngle < π/2` e `minDistance`/`maxDistance` calcolati dal bounding box. Sulla macchina selezionata compare un'etichetta `Html`. Un error boundary mostra un fallback se WebGL manca (Req 5.8).
- **Elenco macchine accessibile.** È un `<ul role="list">` con `<button>` per ogni macchina e lo stato scritto anche come testo. Una regione `aria-live="polite"` annuncia i cambi a rosso.

### Modulo Incidenti (Persona B)

- **Orchestratore_Incidenti.** Gestisce una coda FIFO con 4 richieste concorrenti al massimo e una finestra scorrevole di 20 richieste in 60 s (Req 17.6). Conta le chiamate per incidente e si ferma a 3. Le risposte `retryable` della route vengono riaccodate dopo `retryAfterMs`.
- **rootCause(config, statuses, anomalyStart, alarmMachine).**
  1. Una BFS sugli `upstream` trova le macchine candidate in giallo o rosso, con un'anomalia iniziata prima di quella della macchina in allarme.
  2. Tra le candidate si sceglie quella con l'inizio più antico. A parità si preferisce la più distante, poi l'id lessicograficamente minore.
  3. Il percorso è il più corto da quella macchina verso il sintomo, ottenuto con una BFS sui `downstream` con vicini ordinati.
  4. Con un timeout di 1 s o un'eccezione, il percorso è `[alarmMachine]` con `rootCauseComplete = false`.
- **impact.** L'insieme considerato è il percorso causale ∪ {macchina in allarme} ∪ tutte le macchine a valle.
  - `costPerMin` è la somma dei costi di fermo.
  - `partsAtRiskPerMin` è il massimo di `partsPerMin`: in una linea in serie lo stesso pezzo attraversa tutte le macchine.
  - `savings` = `costPerMin × horizon`.
  - `priority` = `costPerMin × w[risk]`, con `w = { basso: 1, medio: 2, alto: 4 }`. La formula è monotona per costruzione (Req 13.3 e 13.4).
- **escalation(diagnosis, risk, threshold).** È una funzione pura che raccoglie i motivi dell'escalation:
  - `rischio_alto` se il rischio è assente o vale `alto`;
  - `diagnosi_non_disponibile` se la diagnosi manca o la confidenza non è un numero tra 0 e 1;
  - `confidenza_bassa` se la confidenza è sotto la soglia;
  - `azione_non_whitelist` se `codice_azione` non è nella whitelist.

  Il risultato è `escalate = reasons.length > 0`. Il livello di autonomia non è nemmeno un parametro, quindi l'invariante del Req 9.5 vale per costruzione.
- **autonomy(level, decision, action).** Restituisce una modalità tra `suggerisci` (L0), `bozza` (L1), `approva_un_clic` (L2) e `esegui_e_notifica` (L3):
  - le azioni fuori dalla whitelist ricadono su `bozza`;
  - un L3 con escalation diventa `approva_un_clic`;
  - le azioni eseguite salvano uno snapshot che permette l'annullamento (Req 10.8). `riduci_velocita` modifica davvero il simulatore, perché moltiplica per 0,6 la velocità di deriva del guasto.
- **Adattatore_Memoria.** L'interfaccia è `{ search(incidentQuery, k=3), save(entry), reset() }`.
  - `EvolusMemory` chiama `/api/memory`, che fa da proxy server-side. I risultati della ricerca semantica vengono filtrati di nuovo nel client secondo il Req 15.2: stessa macchina o stesso tipo, con almeno un sensore in comune. Così un falso positivo semantico non diventa una citazione.
  - `LocalMemory` usa `localStorage` più `data/memory-seed.json` e filtra in modo esatto.
  - Il timeout di Evolus è 5 s, oltre il quale si passa a `LocalMemory` (Req 15.11).
- **manual.ts.** `parsePages(md)` e `renderPages(pages)` gestiscono il round-trip. `verifyCitation(diagnosis, pages)` imposta `citazione_verificata` e azzera la confidenza se la pagina non esiste.

### API route (server, `runtime = 'nodejs'`, `maxDuration = 60`)

| Route | Input (zod) | Output |
| --- | --- | --- |
| `POST /api/diagnose` | `{ incidentId, scenarioId, alarm, causalPath[], machines[], manualPages[{n,text}], similar[], replay }` | `{ ok: true, diagnosis, meta }` oppure `{ ok: false, retryable, retryAfterMs?, error }` |
| `POST /api/safety` | `{ incidentId, scenarioId, diagnosis, machine, impact, replay }` | `{ ok, risk, meta }` |
| `POST /api/onboard` | `{ manualText (≤ 3 MB), csvRows[], errors?[] }` | `{ ok, config }` |
| `POST /api/memory` | `{ op: 'search' \| 'save' \| 'reset', ... }` | `{ ok, entries }` |
| `GET /api/health` | – | `{ amdKey: boolean, evolusKey: boolean, models: string[], replayDefault }` |

Il corpo di `/api/diagnose` deve stare sotto 4,5 MB, che è il limite di Vercel. Per questo il client invia solo le pagine del manuale della macchina causa radice, già filtrate per parole chiave del sensore e del guasto: al massimo 12 pagine, con la prima pagina dell'indice sempre inclusa.

### Client_LLM (`server/llm/client.ts`)

- **Client.** `new OpenAI({ baseURL: AMD_TOKENFACTORY_BASE_URL, apiKey: AMD_TOKENFACTORY_APIKEY })`. Le variabili d'ambiente non hanno il prefisso `NEXT_PUBLIC_`.
- **Modelli.** Sono configurati per ruolo, con un'alternativa ciascuno. L'elenco è verificato con `GET /v1/models` il 17/10/2026: tutti i modelli citati risultano presenti.

  | Ruolo | Primario | Alternativa | Parametri |
  | --- | --- | --- | --- |
  | Diagnosi | `DeepSeek-V4-Flash` | `Qwen3.8-Flash-Next` | `reasoning_effort: 'medium'`, `response_format: json_object`, `max_tokens: 4000` |
  | Sicurezza | `Gemma-4-31B-IT` | `DeepSeek-V4-Flash` | senza `reasoning_effort` (Gemma accetta solo on/off), `json_object`, `max_tokens: 800` |
  | Onboarding | `DeepSeek-V4-Flash` | `Qwen3.8-Flash-Next` | `medium`, `json_object`, `max_tokens: 8000` |
  | Foto (opzionale) | `Gemma-4-31B-IT` | `DeepSeek-V4.1-Flash` | input immagine |
  | Voce (opzionale) | `MiMo-V2.6-Flash` | – | `input_audio` wav |

  La scelta di DeepSeek-V4-Flash per la diagnosi ha tre motivi. Con un contesto da 1M non ci sono problemi a inserire il manuale. Senza `reasoning_effort` non "pensa" di default, quindi la latenza è prevedibile. Accetta più di un messaggio system. Qwen3.8-Flash-Next invece accetta un solo messaggio system, che deve essere il primo: lo usiamo come alternativa con un unico system.
- **Forma della richiesta.** Un solo messaggio `system` all'indice 0, poi un solo `user`. È la forma compatibile con tutti i modelli secondo la guida.
- **Ritentativi.** Si ritenta solo su 429, 502, 503, timeout ed errori di rete, con al massimo 5 tentativi.
  - Su 429 si rispetta `Retry-After`, con un tetto di 60 s. Senza l'intestazione si usano 1, 2, 4, 8 e 16 s, con jitter di ±20%.
  - Se il tempo residuo dalla scadenza (`maxDuration` meno 5 s) non basta per il prossimo tentativo, la route restituisce `{ retryable: true, retryAfterMs }` e il browser riprova (Req 17.14).
- **Errori.** La guida dice che gli errori possono avere due forme, `{error}` e `{detail:{error}}`, e vanno lette entrambe.
- **Risposta vuota.** Se `finish_reason === 'length'` con contenuto vuoto, si fa un solo ritentativo con `max_tokens × 2`. Non conta nel limite delle 3 chiamate per incidente, come i 429.
- **Log.** `{ agent, model, latencyMs, inTok, outTok, outcome, incidentId }` su `console.log`, senza chiavi né prompt completi. Lo stesso record va al client in `meta` per il benchmark.
- **Replay.** L'hash è `sha256(JSON.stringify({agent, model, messages}))`.
  - In locale, con `RECORD_MODE=1`, la registrazione viene scritta in `data/replay/{agent}.{scenarioId}.{hash}.json`.
  - Su Vercel si leggono i file del bundle tramite import JSON statico di un indice `data/replay/index.json`, generato da `scripts/build-replay-index.ts`. Si cerca prima per hash, poi l'ultima registrazione per `{agent, scenarioId}`.
  - Il replay è attivo se `REPLAY_MODE=1` oppure se il client invia `replay: true`. Lo è anche quando la chiave AMD manca (Req 17.13).

### Prompt (sintesi)

- **Diagnosi, system.** "Sei un ingegnere di manutenzione. Rispondi solo con JSON conforme a questo schema: {...}. Basati esclusivamente sulle pagine del manuale fornite e cita la pagina usata. Se le evidenze non bastano, abbassa la confidenza. `codice_azione` deve essere uno di [...]. Usa `intervento_manutentivo` per qualsiasi intervento fisico."
- **Diagnosi, user.** Contiene, in blocchi delimitati:
  - l'Allarme;
  - il Percorso_Causale con lo stato di ogni macchina;
  - le statistiche della finestra (min, max, trend);
  - le pagine del manuale nel formato `[p. N] testo`;
  - gli interventi simili.
- **Sicurezza, system.** "Valuti il rischio per persone e impianto dell'azione proposta. JSON: {livello_rischio, motivazione}. `alto` per qualsiasi intervento con macchina in tensione, parti rotanti, pressione o temperatura oltre la soglia critica."
- **Contenuto non affidabile.** I testi del manuale e della memoria vengono trattati come dati. Il system prompt dice di ignorare eventuali istruzioni al loro interno, e in ogni caso l'output è vincolato dallo schema e dalla Regola_Escalation.

## Modelli di dati e persistenza

| Dato | Dove |
| --- | --- |
| Configurazioni di esempio, manuali, seed della memoria, replay | `data/` versionata, importata staticamente |
| Stato live (campioni, stati, incidenti) | Store Zustand in memoria, con gli ultimi 60 campioni per sensore |
| Memoria_Fabbrica | Evolus (primaria) oppure `localStorage['fp.memory.v1']` |
| Livelli di autonomia modificati | `localStorage['fp.autonomy.{factoryId}']` |
| Configurazioni da onboarding | `localStorage['fp.factories.custom']` |

## Evolus (RAG della memoria)

Fonte: `evolus-api.json` (OpenAPI, base URL `https://api.evolus.ai`).

**Come funziona il RAG in Evolus.** Non esiste un endpoint di ricerca vettoriale diretta. Il RAG passa da un **agente** a cui è assegnata una **memoria** di tipo `Rag` (type `0`). L'agente fa la ricerca semantica e risponde con `citations[].documentId`.

**Autenticazione: tre livelli, verificati con la nostra chiave**

| Operazione | Header | Stato con la nostra chiave |
| --- | --- | --- |
| `/v1/chat/completions`, `/v1/models` (OpenAI-compatible) | `Authorization: Bearer <AppKey>`, `model = "{applicationId}:{agentId}"` | Funziona: `GET /v1/models` → 200, lista vuota (nessun agente ancora) |
| REST `/api/v1/agents`, `/memories/{id}/documents`, `/agents/{id}/ask` | `X-ApiKey` + `X-Application-Id` (GUID) | 401 senza `X-Application-Id`: **ci serve l'Application ID** |
| `POST /api/v1/memories/simple` (creazione memoria) | Solo **User API Key**: `X-User-ApiKey` + `X-Application-Id` | Serve una chiave personale, oppure si crea la memoria dal portale |

**Verifica del 17/10 con la nuova chiave di applicazione:** `GET /api/v1/agents` → 200 (lista vuota), `GET /memories/document-formats` → 200 (md, pdf, docx, json, fino a 50 MB). `GET /api/v1/memories` → 401, ed è atteso perché quell'endpoint richiede la User API Key. Tutto il setup si può fare con la chiave di applicazione, passando da `knowledge-memory`.

**Setup una tantum** (script `scripts/evolus-setup.ts`, idempotente, che salva gli ID ottenuti in `.env.local`):
1. Creare l'agente `factorypilot-maintenance-memory` con `POST /api/v1/agents`.
2. Creare la memoria RAG con `POST /api/v1/agents/{agentId}/knowledge-memory` (type `Rag`). Accetta la chiave di applicazione, crea la memoria personale dell'agente e la collega. Restituisce il `memoryId`.
   - Prompt: "Sei l'archivio di manutenzione. Cerca nella memoria solo gli interventi pertinenti e rispondi SOLO con JSON `{matches:[{id, machineId, machineType, sensorIds, realCause, fix, durationMin, closedAt, isSample, relevance}]}`, massimo 3, senza inventare."
   - `modelKey` a null, cioè il modello di default Evolus.
3. Il collegamento tra memoria e agente è già fatto dal passo 2.
4. Caricare il seed:
   - un file `.md` per intervento, con `POST /api/v1/memories/{memoryId}/documents` (multipart, `language=it`, `backgroundIngestion=true`);
   - le schede macchina e il manuale della pompa (PDF o md) nella stessa memoria, così l'agente può citare anche quelli.

   Ogni documento ha un front-matter con i metadati strutturati (`id`, `machineId`, `machineType`, `sensorIds`, `closedAt`, `isSample`), che rientrano nel JSON della risposta.

**Uso a runtime** (`server/evolus.ts`, solo server):
- **`search(incident)`** chiama `POST https://api.evolus.ai/v1/chat/completions` con l'OpenAI SDK (`baseURL: https://api.evolus.ai/v1`, `model: "${EVOLUS_APPLICATION_ID}:${EVOLUS_MEMORY_AGENT_ID}"`). Il messaggio contiene macchina, tipo, sensori e sintomi. Si estrae il JSON e lo si valida con zod.
  - Non si usa `response_format`: lo schema Evolus non lo prevede e potrebbe rifiutarlo.
  - Il client poi applica il filtro esatto del Req 15.2. L'OpenAI SDK è lo stesso già usato per AMD, quindi non serve codice nuovo.
- **`save(entry)`** chiama `POST /api/v1/memories/{memoryId}/documents` (multipart, file `intervento-{id}.md`) con `X-ApiKey` e `X-Application-Id`.
  - L'ingestione è asincrona, quindi il documento è ricercabile solo dopo qualche secondo o minuto.
  - Per questo `save` scrive **sempre anche in `LocalMemory`**, e la ricerca unisce Evolus e i risultati locali, eliminando i duplicati per `id`. Così la scena "al secondo guasto cita l'intervento appena chiuso" funziona subito.
- **`reset()`** cancella in Evolus solo i documenti non di seed (`DELETE .../documents/{id}`, con id salvati in locale). "Ripristina demo" agisce subito sulla parte locale.

**Limiti e costi**
- 60 richieste al minuto per applicazione, con 429 e `Retry-After`. Il backoff è lo stesso del Client_LLM.
- 402 significa crediti LLM esauriti, nel qual caso si passa a `LocalMemory`.
- Si fa al massimo 1 chiamata Evolus per incidente, con timeout di 5 s (Req 15.11).

**Variabili d'ambiente:** `EVOLUS_SPACE_APIKEY` (presente), `EVOLUS_APPLICATION_ID`, `EVOLUS_MEMORY_ID`, `EVOLUS_MEMORY_AGENT_ID` (da ottenere), più `EVOLUS_USER_APIKEY`, solo se si crea la memoria via API.

**Premio Evolus.** Usiamo almeno due building block: Memory (RAG) e Agent, con le API Integration e OpenAI-compatible. Se resta tempo se ne può aggiungere un terzo, il **JSON output structure / AskFile** per l'onboarding: carichi il PDF e ricevi in risposta il JSON delle macchine. Non so se basta per il requisito: va chiesto su Discord.

## Scenario demo

**Fabbrica principale:** `bottling-line.json`, una linea di imbottigliamento acqua da 6.000 bottiglie l'ora (100 al minuto).

| # | Macchina | Tipo | Sensori | Costo fermo €/min |
| --- | --- | --- | --- | --- |
| P1 | Pompa centrifuga di alimentazione | pompa_centrifuga | vibrazione mm/s, temperatura cuscinetto °C, corrente A | 40 |
| F1 | Riempitrice rotativa | riempitrice | portata L/min, scarti livello %, temperatura °C | 90 |
| C1 | Tappatrice | tappatrice | coppia Nm, scarti %, vibrazione mm/s | 40 |
| L1 | Etichettatrice | etichettatrice | velocità m/min, scarti %, temperatura colla °C | 30 |
| K1 | Nastro di uscita e fardellatrice | nastro | corrente motore A, temperatura motore °C | 20 |

Collegamenti: P1 → F1 → C1 → L1 → K1.

- **Costi.** Il costo di fermo dell'intera linea è di circa 220 €/min. È un'ipotesi basata sul margine perso a 100 bottiglie al minuto più il costo del personale, e va dichiarata come stima.
- **Tempo di riferimento.** `manualSearchRefSec` vale 2.700, cioè 45 minuti di diagnosi manuale. Anche questa è un'ipotesi dichiarata.

**Scenario A, la storia principale con escalation.** Il guasto è "Usura cuscinetto lato giunto P1" ed è a cascata.
1. Su P1 la vibrazione sale da circa 2,5 a oltre 7,1 mm/s, il valore di soglia critica per pompe di classe II secondo ISO 10816-3, usato come riferimento. La temperatura del cuscinetto passa da 55 a oltre 85 °C.
2. Dopo 8 s su F1 la portata oscilla e gli scarti di livello salgono dallo 0,5% a oltre il 3%, quindi F1 diventa rossa.
3. Il tecnico vedrebbe F1 rossa e penserebbe alla riempitrice. FactoryPilot invece risale a P1, perché è la macchina con l'anomalia iniziata per prima.
4. La diagnosi parla di cuscinetto usurato o di lubrificazione insufficiente, cita la pagina del manuale della pompa dedicata a vibrazioni e cuscinetti e propone la sostituzione del cuscinetto con `codice_azione` uguale a `intervento_manutentivo`.
5. Gemma assegna rischio `alto` perché l'intervento è su parti rotanti. Scatta l'escalation e il responsabile approva.
6. Nasce l'ordine di lavoro. Quando il tecnico lo chiude, l'intervento viene salvato in memoria.
7. Se si inietta di nuovo lo stesso guasto, la diagnosi cita l'intervento appena chiuso. Questo dimostra la memoria di fabbrica.

**Scenario B, il caso minore gestito in autonomia.** Il guasto è "Surriscaldamento motore nastro K1" ed è locale. La temperatura del motore sale lentamente fino alla soglia critica. La diagnosi propone `riduci_velocita` con confidenza 0,8 e rischio `basso`. Con K1 configurato in L3 per `riduci_velocita`, l'azione viene eseguita e notificata, la deriva rallenta e il responsabile può annullarla.

**Fabbrica alternativa:** `machining-cell.json`, una cella CNC con compressore d'aria, centro di lavoro, lavatrice pezzi e controllo dimensionale. Serve a mostrare che lo stesso prodotto si adatta a un'altra fabbrica senza toccare il codice.

**Manuali.**
- **P1.** Ci vuole il manuale pubblico di installazione e uso di una pompa centrifuga industriale reale, con una sezione di diagnosi guasti (vibrazione, rumore, cuscinetti). Un candidato è un manuale Grundfos della serie CR, oppure KSB Etanorm. Non ho verificato URL né licenze: va scaricato da voi dal sito del produttore, controllando che il PDF abbia testo selezionabile. Si estrae con `scripts/extract-manual.ts` e nel pitch va citata la fonte.
- **Le altre macchine.** Hanno manuali brevi (3–6 pagine) scritti da noi in markdown con i marcatori `<!-- page: N -->`, dichiarati come sintetici. Coprono le sezioni di diagnosi necessarie agli scenari.
- **Seed della memoria.** Contiene 3 interventi di esempio, etichettati come tali:
  - P1, 12/09/2026: "allineamento giunto, 55 min";
  - K1, 28/09/2026: "pulizia ventola motore, 20 min";
  - F1, 03/10/2026: "sostituzione guarnizione valvola di riempimento, 40 min".

**Numeri per le slide.** Il tempo allarme→diagnosi si misura (atteso 10–25 s) e si confronta con i 45 minuti di riferimento. Il risparmio per incidente si stima con il Calcolatore_Impatto, sui minuti di diagnosi evitati moltiplicati per il costo al minuto. Tutti i valori vanno mostrati come stime.

## Proprietà di correttezza

Ogni proprietà è un test `fast-check` in `tests/`.

1. **Round-trip della configurazione.** `parse(serialize(c)) ≡ c` per ogni configurazione generata valida (Req 1.7).
2. **Configurazioni non valide.** Ciclo, riferimento mancante e id duplicato producono sempre un errore e mai un oggetto (Req 1.4, 1.5, 1.10).
3. **Round-trip di Alarm.** Dopo JSON e zod l'allarme è identico (Req 4.3).
4. **Round-trip della Diagnosi** (Req 8.6).
5. **Round-trip del manuale.** `parsePages(renderPages(p)) ≡ p` per testi senza `<!-- page:` (Req 7.5).
6. **Invariante del verde.** Su campioni entro le soglie e con |z| ≤ warn ci sono zero allarmi e stato sempre verde (Req 3.7).
7. **Determinismo del simulatore.** Stesso seme e stessi comandi agli stessi tick danno sequenze identiche (Req 2.7).
8. **Invariante di sicurezza.** Per ogni rischio, confidenza e azione, se il rischio è `alto` oppure la confidenza è sotto la soglia, allora `escalate === true` (Req 9.5).
9. **Autonomia limitata.** Nessuna combinazione produce `esegui_e_notifica` per un'azione fuori whitelist o con escalation (Req 10.5, 10.6).
10. **Percorso causale valido.** Su DAG casuali, ogni coppia consecutiva è un collegamento a valle, l'ultimo elemento è la macchina in allarme e non ci sono ripetizioni (Req 12.3).
11. **Priorità monotona.** È crescente nel costo a parità di rischio e crescente nel rischio a parità di costo (Req 13.3, 13.4).
12. **Filtro della memoria.** I risultati sono al massimo 3, tutti della stessa macchina o dello stesso tipo, con un sensore in comune e ordinati per data decrescente (Req 15.2).

## Gestione degli errori

| Situazione | Comportamento |
| --- | --- |
| 429 o 5xx da Token Factory | Backoff nella route, poi `retryable` al browser. Dopo i tentativi: diagnosi non disponibile ed escalation |
| JSON non valido dal modello | Un solo ritentativo, poi diagnosi non disponibile ed escalation |
| Pagina citata inesistente | Confidenza a 0 e badge "citazione non verificata", con escalation automatica per confidenza bassa |
| Gemma non conforme o in timeout | Rischio `alto` ed escalation |
| Evolus non disponibile | Si usa `LocalMemory` e compare un badge "memoria locale" |
| Chiave AMD assente | Replay forzato e badge "Replay" |
| WebGL assente | Fallback con il solo elenco testuale |
| Rete assente | Badge "AI non raggiungibile", mentre simulazione e mappa continuano |

## Strategia di test

- **Unit e property (Vitest e fast-check).** Coprono tutta la logica pura di `modules/**` e `shared/**`. Il CI locale è `npm test -- --run`.
- **Route.** Si testano con un Client_LLM finto: `fetch` mockato per 429 con `Retry-After`, JSON malformato, `finish_reason: length` e risposta con `{detail:{error}}`.
- **Smoke manuale prima del video.** Si percorrono gli scenari A e B in replay e poi dal vivo.
- **Nessun test end-to-end del 3D**, per mancanza di tempo.

## Priorità di implementazione e ordine dei tagli

| Priorità | Contenuto | Se manca il tempo |
| --- | --- | --- |
| P0 | Contratti, configurazione, simulatore, motore anomalie, mappa 3D di base, Client_LLM, diagnosi, sicurezza, escalation, coda di approvazione, ordine di lavoro, replay | Non si taglia: è la demo |
| P1 | Causa radice e percorso sulla mappa, impatto in euro e priorità, pannello metriche | Si taglia solo l'animazione del percorso |
| P2 | Autonomia L0–L3 (scenario B), memoria con seed e chiusura | Restano L0 e L3, senza annullamento |
| P3 | Evolus come backend della memoria | Si resta su `LocalMemory` |
| P4 | Onboarding da PDF e CSV, seconda fabbrica | Si mostra solo la seconda configurazione già pronta |
| P5 | Foto con Gemma, nota vocale, benchmark | Si citano come sviluppi futuri |
