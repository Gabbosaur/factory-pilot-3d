# Copione demo (video 2–3 min) – voce e schermo in inglese

Dati sintetici: dichiararlo a voce e a schermo (badge "SYNTHETIC DATA" sempre visibile). Se la rete è instabile attivare **Replay**: sono le risposte reali di AMD Token Factory registrate.

L'app è organizzata in pagine, con una barra di navigazione in alto: **Overview** (il digital twin 3D), **Machines** (macchine raggruppate per tipo), **Incidents** (lista e dettaglio), **Metrics** (impatto misurato), **Settings** (livelli di autonomia). La simulazione gira in continuo passando da una pagina all'altra. Al primo avvio parte un tour guidato: per la demo si può saltare.

| Tempo | Pagina · Azione a schermo | Voce (EN) |
| --- | --- | --- |
| 0:00 | Overview · mappa 3D, tutto OK, bottiglie che scorrono | "This is a water bottling line: feed pump, filler, capper, conveyor. FactoryPilot watches it in real time." |
| 0:10 | Overview · seleziona *Pump P1 bearing wear* → **Inject fault** | "Let's simulate a worn bearing on the pump." |
| 0:20 | Overview · P1 Warning→Alarm, poi F1 Alarm dopo ~8 s | "The first critical alarm comes from the filler: fill-level rejects are rising. A technician would go there first." |
| 0:35 | Overview · percorso arancione P1 → F1, card "Root cause traced back along the line" | "FactoryPilot walks the line upstream: the problem starts at the pump." |
| 0:45 | Incidents · apri l'incidente, diagnosi con citazione ✓ verified, ricambi, confidenza | "The diagnosis, generated on AMD Token Factory, cites the exact manual page and the spare parts." |
| 1:00 | Incidents · badge "High risk" (Gemma) + "Needs your decision" | "Gemma assesses the risk: rotating parts, so a person decides. That rule lives in code, not in the AI." |
| 1:10 | Incidents · costo €/min e risparmio nella card | "Downtime costs 190 euros a minute: priority follows business impact." |
| 1:20 | Incidents · **Approve** → Work order | "One click creates the work order." |
| 1:30 | Incidents · **Close intervention** (cause, work, 45 min) | "The technician closes the job, and the factory remembers it." |
| 1:40 | Overview · **Reset** → inietta *Conveyor K1 motor overheating* | "Now a minor issue." |
| 1:55 | notifica "Reduce line speed … executed autonomously" + **Undo** | "Low-impact, reversible action at autonomy level L2: it handles it on its own and tells the manager." |
| 2:05 | Machines · macchine raggruppate per tipo, riepilogo di stato | "At a glance the manager sees every machine grouped by type and where the problems are." |
| 2:15 | Metrics · impatto misurato | "Diagnosis in seconds instead of 45 minutes of searching, with the downtime avoided and the savings." |
| 2:25 | Overview · selettore → *twin fillers* oppure **+ New factory** con CSV di esempio | "A factory is just a file: it adapts to any line. FactoryPilot 3D: from sensor to action." |

Numeri reali misurati (17/10): diagnosi DeepSeek-V4-Flash ~8 s (senza ragionamento), sicurezza Gemma-4-31B-IT 2–13 s.
