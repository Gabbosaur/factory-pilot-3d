# Copione demo (video 2–3 min) – voce e schermo in inglese

Dati sintetici: dichiararlo a voce e a schermo (badge "SYNTHETIC DATA" sempre visibile). Se la rete è instabile attivare **Replay**: sono le risposte reali di AMD Token Factory registrate.

| Tempo | Azione a schermo | Voce (EN) |
| --- | --- | --- |
| 0:00 | Mappa 3D, tutto OK, bottiglie che scorrono | "This is a water bottling line: feed pump, filler, capper, conveyor. FactoryPilot watches it in real time." |
| 0:10 | Seleziona *Pump P1 bearing wear* → **Inject fault** | "Let's simulate a worn bearing on the pump." |
| 0:20 | P1 Warning→Alarm, poi F1 Alarm dopo ~8 s | "The first critical alarm comes from the filler: fill-level rejects are rising. A technician would go there first." |
| 0:35 | Percorso arancione P1 → F1, card "Root cause traced back along the line" | "FactoryPilot walks the line upstream: the problem starts at the pump." |
| 0:45 | Diagnosi con citazione ✓ verified, ricambi, confidenza | "The diagnosis, generated on AMD Token Factory, cites the exact manual page and the spare parts." |
| 1:00 | Badge "High risk" (Gemma) + "Manager decision required" | "Gemma assesses the risk: rotating parts, so a person decides. That rule lives in code, not in the AI." |
| 1:10 | Costo €/min e risparmio, pannello metriche | "Downtime costs 190 euros a minute: priority follows business impact." |
| 1:20 | **Approve** → Work order | "One click creates the work order." |
| 1:30 | **Close intervention** (cause, work, 45 min) | "The technician closes the job, and the factory remembers it." |
| 1:40 | **Reset machines** → inietta *Conveyor K1 motor overheating* | "Now a minor issue." |
| 1:55 | Notifica "Reduce line speed … executed autonomously" + **Undo** | "Low-impact, reversible action at autonomy level L3: it handles it on its own and tells the manager." |
| 2:10 | (Opzionale) Re-inietta P1 → "Factory memory" cita l'intervento appena chiuso | "Next time, it cites the previous repair." |
| 2:20 | Selettore → *twin fillers* oppure **+ New factory** con CSV di esempio | "A factory is just a file: it adapts to any line." |
| 2:30 | Pannello metriche | "Diagnosis in seconds instead of 45 minutes of searching. FactoryPilot 3D: from sensor to action." |

Numeri reali misurati (17/10): diagnosi DeepSeek-V4-Flash ~8 s (senza ragionamento), sicurezza Gemma-4-31B-IT 2–13 s.
