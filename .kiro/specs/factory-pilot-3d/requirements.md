# Documento dei Requisiti

## Introduzione

FactoryPilot 3D è un copilota per la manutenzione industriale sviluppato per l'AMD Developer Hackathon ACT III (track "Intelligent Industry"). Il prodotto aiuta un'azienda manifatturiera a ridurre il fermo macchina e ad aumentare la sicurezza trasformando dati di sensori in allarmi, diagnosi spiegate, raccomandazioni e azioni approvate da un responsabile umano.

Il prodotto mostra una mappa 3D stilizzata e navigabile (low-poly, stile videogioco) della fabbrica, con lo stato delle macchine in tempo reale. Una fabbrica simulata con dati sintetici (dichiarati come tali) alimenta un rilevatore di anomalie deterministico, senza LLM. Solo quando scatta un allarme il sistema invoca gli agenti LLM su infrastruttura AMD (AMD Token Factory API): un Agente_Diagnosi che cita il manuale e un Agente_Sicurezza basato su Gemma. Una regola deterministica nel codice ha l'ultima parola sull'escalation verso un umano.

Elementi di innovazione in ambito: analisi della causa radice lungo la linea di produzione, impatto economico e prioritizzazione, livelli di autonomia configurabili (L0–L3), memoria di fabbrica che apprende dagli interventi chiusi, onboarding in 5 minuti da manuale PDF e lista sensori.

Utenti: tecnici di manutenzione, operatori di linea, responsabile di produzione/manutenzione (approvatore).

Architettura di deploy: unica applicazione Next.js ospitata su Vercel. Simulatore, Motore_Anomalie, Analizzatore_Causa_Radice, Calcolatore_Impatto, Regola_Escalation e Gestore_Autonomia girano nel browser come TypeScript deterministico. Le sole chiamate di inferenza passano da API route serverless (runtime Node) che custodiscono la chiave API. Lo stato vive in uno store client; la Memoria_Fabbrica è persistita nel browser; le registrazioni della Modalità_Replay sono file JSON versionati nel repository.

Vincoli di progetto: stack unico Next.js/TypeScript; team di due persone con modulo Monitoraggio (A) e modulo Incidenti (B) che condividono il contratto di tipo `Alarm`; scadenza 18 ottobre 2026. I requisiti contrassegnati come "(Opzionale)" sono estensioni da realizzare solo se resta tempo.

Fuori ambito (possibile estensione futura): replay/timeline dell'incidente sulla Mappa_3D, cioè la riproduzione temporale di come l'anomalia si è propagata lungo la linea.

## Glossario

- **FactoryPilot**: il sistema software complessivo descritto in questo documento (applicazione Next.js su Vercel, con logica di simulazione nel browser e API route serverless per l'inferenza).
- **API_Route_Inferenza**: route handler Next.js serverless (runtime Node) che riceve una richiesta dal browser, la inoltra all'AMD_Token_Factory tramite il Client_LLM e restituisce la risposta.
- **Configurazione_Fabbrica**: documento strutturato (JSON) che descrive macchine, sensori, soglie, collegamenti a monte/valle, costi di fermo, layout della Mappa_3D e Livelli_Autonomia di una fabbrica.
- **Parser_Configurazione**: componente che legge e valida un testo JSON producendo un oggetto Configurazione_Fabbrica.
- **Serializzatore_Configurazione**: componente che converte un oggetto Configurazione_Fabbrica in testo JSON valido.
- **Simulatore**: componente eseguito nel browser che genera dati sintetici dei sensori (vibrazione, temperatura, consumo elettrico) per ogni macchina della Configurazione_Fabbrica.
- **Guasto_Iniettato**: alterazione controllata dei dati generati dal Simulatore, attivata dall'utente per la demo.
- **Campione**: singola lettura di un sensore con identificativo macchina, identificativo sensore, valore e timestamp.
- **Motore_Anomalie**: componente deterministico (senza LLM) che valuta i Campioni con z-score e soglie fisse e genera Allarmi.
- **Allarme**: oggetto conforme al Contratto_Allarme che segnala un'anomalia su una macchina.
- **Contratto_Allarme**: tipo TypeScript `Alarm` condiviso tra modulo Monitoraggio e modulo Incidenti.
- **Flusso_Eventi**: store di stato lato client (ad esempio Zustand) a cui i componenti dell'interfaccia sono sottoscritti, che distribuisce Campioni, stati macchina, Allarmi e aggiornamenti degli Incidenti.
- **Stato_Macchina**: uno tra `verde` (normale), `giallo` (attenzione), `rosso` (allarme critico).
- **Mappa_3D**: vista 3D low-poly navigabile della fabbrica, realizzata con React Three Fiber.
- **Incidente**: entità creata a partire da uno o più Allarmi, che raccoglie diagnosi, valutazione di rischio, impatto economico, decisioni e stato di avanzamento.
- **Manuale_Markdown**: versione markdown del manuale della macchina, estratta una sola volta dal PDF, con marcatori di pagina nel formato `<!-- page: N -->`.
- **Estrattore_Manuale**: componente che converte il PDF del manuale in Manuale_Markdown.
- **Client_LLM**: componente eseguito nelle API_Route_Inferenza che invia richieste all'AMD_Token_Factory e gestisce limiti di frequenza, ritentativi e Modalità_Replay.
- **AMD_Token_Factory**: API di inferenza AMD compatibile con OpenAI, accessibile con una singola chiave API condivisa.
- **Agente_Diagnosi**: chiamata LLM su AMD_Token_Factory che produce la Diagnosi.
- **Diagnosi**: oggetto JSON con campi `causa_probabile`, `pagina_manuale`, `citazione`, `confidenza` (0–1), `azione_raccomandata` (testo per il Tecnico), `codice_azione` (uno tra `riduci_velocita`, `apri_ticket`, `pianifica_ispezione`, `intervento_manutentivo`), `ricambi`.
- **Agente_Sicurezza**: chiamata a un modello Gemma su AMD_Token_Factory che produce la Valutazione_Rischio.
- **Valutazione_Rischio**: oggetto JSON con campi `livello_rischio` (`basso`, `medio`, `alto`) e `motivazione`.
- **Regola_Escalation**: funzione deterministica nel codice che decide se un Incidente richiede l'intervento del Responsabile.
- **Soglia_Confidenza**: valore numerico configurabile (predefinito 0,7) sotto il quale una Diagnosi è considerata incerta.
- **Livello_Autonomia**: uno tra L0 (solo suggerimento), L1 (suggerimento con azione preparata, esecuzione manuale), L2 (azione in whitelist eseguita dopo approvazione con un clic), L3 (azione in whitelist eseguita autonomamente con notifica).
- **Gestore_Autonomia**: componente deterministico che applica il Livello_Autonomia configurato per tipo di macchina e tipo di azione.
- **Azione_Whitelist**: azione a basso rischio e reversibile ammessa all'esecuzione autonoma: `riduci_velocita`, `apri_ticket`, `pianifica_ispezione`.
- **Ordine_di_Lavoro**: documento generato dopo l'approvazione del Responsabile, con macchina, causa, azione, ricambi, priorità e assegnatario.
- **Responsabile**: utente con ruolo di responsabile di produzione/manutenzione, che approva o rifiuta le azioni.
- **Tecnico**: utente con ruolo di tecnico di manutenzione, che esegue e chiude gli interventi.
- **Operatore**: utente con ruolo di operatore di linea, che osserva lo stato delle macchine.
- **Analizzatore_Causa_Radice**: componente che percorre il grafo dei collegamenti a monte della Configurazione_Fabbrica per individuare la macchina origine di un effetto a cascata.
- **Percorso_Causale**: sequenza ordinata di macchine dalla causa radice alla macchina che manifesta il sintomo.
- **Calcolatore_Impatto**: componente deterministico che stima costo del fermo, pezzi a rischio e risparmio se si interviene subito.
- **Punteggio_Priorità**: valore numerico che ordina gli Incidenti in base all'impatto economico stimato e al livello di rischio.
- **Memoria_Fabbrica**: archivio degli interventi chiusi (causa reale, intervento, durata, data) e delle schede macchina, indicizzato per il recupero semantico (RAG) su Evolus tramite un'API route server; in assenza di Evolus usa un archivio locale nel `localStorage` del browser. È inizializzata con interventi di esempio versionati nel repository.
- **Adattatore_Memoria**: interfaccia unica con due implementazioni (Evolus e locale) per salvare e recuperare interventi dalla Memoria_Fabbrica.
- **Orchestratore_Incidenti**: componente eseguito nel browser che, per ogni Incidente, invoca in sequenza le API_Route_Inferenza e mette in coda le richieste.
- **Modulo_Onboarding**: componente che, da un manuale PDF e una lista sensori/CSV, genera una Configurazione_Fabbrica tramite LLM.
- **Modalità_Replay**: modalità in cui il Client_LLM restituisce risposte precedentemente registrate invece di chiamare l'AMD_Token_Factory.
- **Pannello_Metriche**: vista che mostra le metriche di miglioramento misurabili.

## Requisiti

### Requisito 1: Configurazione della fabbrica

**User Story:** Come responsabile di produzione, voglio descrivere la fabbrica con un file di configurazione, così che lo stesso prodotto funzioni per tipi di fabbrica diversi.

#### Criteri di Accettazione

1. THE Configurazione_Fabbrica SHALL descrivere da 1 a 50 macchine e, per ogni macchina: un identificativo univoco (stringa non vuota, massimo 64 caratteri), un nome (stringa non vuota, massimo 100 caratteri), un tipo (stringa non vuota, massimo 50 caratteri), una posizione nella Mappa_3D (coordinate numeriche x, y, z), dimensioni nella Mappa_3D (larghezza, altezza e profondità maggiori di 0), da 0 a 20 sensori ciascuno con nome, unità di misura e soglie minima e massima numeriche, collegamenti a monte e a valle espressi come elenchi di identificativi macchina (anche vuoti), un costo di fermo al minuto (numero da 0 a 1.000.000), pezzi prodotti al minuto (numero da 0 a 10.000) e un riferimento al Manuale_Markdown (stringa non vuota).
2. WHEN viene fornito un testo JSON sintatticamente corretto che rispetta lo schema della Configurazione_Fabbrica e i vincoli dei criteri 4, 5 e 10, THE Parser_Configurazione SHALL produrre un oggetto Configurazione_Fabbrica contenente tutte le macchine, i sensori e i collegamenti presenti nel testo.
3. IF il testo JSON fornito non rispetta lo schema della Configurazione_Fabbrica (campo obbligatorio mancante, tipo di dato errato, valore fuori dai limiti del criterio 1, oppure soglia minima di un sensore maggiore della soglia massima), THEN THE Parser_Configurazione SHALL restituire un errore che elenca, per ogni violazione rilevata, il percorso del campo non valido e il motivo, senza produrre alcun oggetto Configurazione_Fabbrica parziale.
4. IF un collegamento a monte o a valle fa riferimento a un identificativo macchina inesistente nella stessa Configurazione_Fabbrica, THEN THE Parser_Configurazione SHALL restituire un errore che indica l'identificativo della macchina di origine e l'identificativo inesistente referenziato, senza produrre alcun oggetto Configurazione_Fabbrica.
5. IF i collegamenti tra macchine formano un ciclo (inclusa una macchina collegata a sé stessa), THEN THE Parser_Configurazione SHALL restituire un errore che indica gli identificativi delle macchine coinvolte nel ciclo, senza produrre alcun oggetto Configurazione_Fabbrica.
6. WHEN il Serializzatore_Configurazione riceve un oggetto Configurazione_Fabbrica valido, THE Serializzatore_Configurazione SHALL produrre un testo JSON conforme allo schema della Configurazione_Fabbrica.
7. FOR ALL oggetti Configurazione_Fabbrica validi, la serializzazione seguita dal parsing SHALL produrre un oggetto equivalente all'originale, cioè con le stesse macchine, gli stessi valori di ogni campo e gli stessi collegamenti a monte e a valle (proprietà di round-trip).
8. THE FactoryPilot SHALL includere almeno due Configurazioni_Fabbrica di esempio, valide secondo il Parser_Configurazione, con layout diversi (differente numero di macchine oppure differente struttura dei collegamenti), elencate per nome in un selettore dell'interfaccia.
9. IF il testo fornito non è JSON sintatticamente corretto, THEN THE Parser_Configurazione SHALL restituire un errore che indica che il testo non è JSON valido e la posizione (riga e colonna) del primo errore di sintassi, senza produrre alcun oggetto Configurazione_Fabbrica.
10. IF due o più macchine nella Configurazione_Fabbrica hanno lo stesso identificativo, THEN THE Parser_Configurazione SHALL restituire un errore che indica l'identificativo duplicato, senza produrre alcun oggetto Configurazione_Fabbrica.
11. WHEN l'utente seleziona una Configurazione_Fabbrica di esempio dal selettore dell'interfaccia, THE FactoryPilot SHALL sostituire la configurazione attiva e mostrare nella Mappa_3D tutte e sole le macchine della configurazione selezionata entro 3 secondi.

### Requisito 2: Fabbrica simulata

**User Story:** Come presentatore della demo, voglio una fabbrica simulata con dati realistici e la possibilità di iniettare un guasto, così da mostrare il prodotto in azione in modo ripetibile.

#### Criteri di Accettazione

1. WHILE la simulazione è attiva, THE Simulatore SHALL generare un Campione al secondo (intervallo tra Campioni consecutivi dello stesso sensore compreso tra 0,9 e 1,1 secondi) per ciascun sensore (ad esempio vibrazione, temperatura, consumo elettrico, portata, tasso di scarti) di ogni macchina della Configurazione_Fabbrica attiva, con identificativo macchina, identificativo sensore, valore e timestamp valorizzati.
2. WHILE nessun Guasto_Iniettato è attivo su una macchina, THE Simulatore SHALL generare per ogni sensore di quella macchina valori con rumore casuale compresi tra il minimo e il massimo dell'intervallo nominale definito per quel sensore nella Configurazione_Fabbrica, in modo che il 100% dei Campioni resti entro l'intervallo nominale e al di sotto della soglia di attenzione fissa del sensore.
3. WHEN l'utente preme il pulsante "Inietta guasto" dopo aver scelto una macchina della Configurazione_Fabbrica attiva e un tipo di guasto tra quelli offerti dall'interfaccia (almeno un tipo locale e un tipo a cascata), THE Simulatore SHALL produrre il primo Campione alterato dal Guasto_Iniettato sulla macchina scelta entro 2 secondi e SHALL far superare la soglia critica fissa di almeno un sensore di quella macchina entro 30 secondi dalla pressione del pulsante.
4. WHEN l'utente inietta un Guasto_Iniettato di tipo a cascata, THE Simulatore SHALL alterare i Campioni di ogni macchina direttamente o indirettamente a valle della macchina guasta, secondo i collegamenti della Configurazione_Fabbrica, facendo superare la soglia di attenzione fissa di almeno un sensore di ciascuna, con un inizio dell'alterazione ritardato di almeno 5 secondi e al massimo 30 secondi rispetto all'inizio dell'alterazione della macchina immediatamente a monte.
5. WHEN l'utente preme il pulsante "Ripristina", THE Simulatore SHALL rimuovere tutti i Guasti_Iniettati attivi e SHALL generare, a partire dal Campione prodotto entro 2 secondi dalla pressione, valori di tutte le macchine compresi negli intervalli nominali della Configurazione_Fabbrica.
6. THE FactoryPilot SHALL mostrare in ogni vista dell'interfaccia, senza possibilità di chiusura da parte dell'utente, un'etichetta testuale visibile che indica che i dati sono sintetici.
7. WHERE è fornito un seme di generazione intero compreso tra 0 e 4.294.967.295, THE Simulatore SHALL produrre una sequenza di valori dei Campioni identica valore per valore in due esecuzioni con lo stesso seme, la stessa Configurazione_Fabbrica e la stessa sequenza di comandi ("Inietta guasto" e "Ripristina") applicati allo stesso indice di Campione.
8. IF l'utente richiede l'iniezione di un guasto su una macchina che ha già un Guasto_Iniettato attivo, oppure su un identificativo macchina o un tipo di guasto non presenti nella Configurazione_Fabbrica attiva, THEN THE Simulatore SHALL rifiutare la richiesta lasciando invariati i Guasti_Iniettati attivi e THE FactoryPilot SHALL mostrare un messaggio di errore che indica il motivo del rifiuto.
9. WHEN l'utente cambia la Configurazione_Fabbrica attiva, THE Simulatore SHALL rimuovere tutti i Guasti_Iniettati attivi e SHALL generare entro 2 secondi Campioni esclusivamente per le macchine della nuova Configurazione_Fabbrica attiva.

### Requisito 3: Rilevamento anomalie deterministico

**User Story:** Come tecnico di manutenzione, voglio che le anomalie vengano rilevate in modo affidabile e immediato, così da intervenire prima del fermo macchina.

#### Criteri di Accettazione

1. WHEN il Motore_Anomalie riceve un Campione valido, THE Motore_Anomalie SHALL calcolare, entro 100 ms dalla ricezione, lo z-score del valore come (valore − media) / deviazione standard dei 60 Campioni precedenti dello stesso sensore della stessa macchina (finestra mobile).
2. WHEN il valore assoluto dello z-score è strettamente maggiore della soglia di attenzione configurata (predefinita 2,5) oppure il valore è strettamente maggiore della soglia di attenzione fissa del sensore, e nessuna condizione del criterio 3 è soddisfatta, THE Motore_Anomalie SHALL impostare lo Stato_Macchina a `giallo` entro 100 ms dalla ricezione del Campione.
3. WHEN il valore assoluto dello z-score è strettamente maggiore della soglia critica configurata (predefinita 3,5) oppure il valore è strettamente maggiore della soglia critica fissa del sensore, THE Motore_Anomalie SHALL impostare lo Stato_Macchina a `rosso` e generare un Allarme conforme al Contratto_Allarme con gravità `rosso` entro 100 ms dalla ricezione del Campione, con precedenza su `giallo` quando entrambe le condizioni sono soddisfatte.
4. WHILE esiste un Allarme aperto per la stessa macchina e lo stesso sensore, WHEN un nuovo Campione di quel sensore soddisfa una condizione del criterio 3, THE Motore_Anomalie SHALL aggiornare l'Allarme esistente con valore, z-score, soglia superata e finestra degli ultimi Campioni del nuovo Campione, mantenendo invariati identificativo e timestamp di apertura, senza generare un nuovo Allarme.
5. WHEN, per ciascun sensore di una macchina, gli ultimi 10 Campioni consecutivi hanno valore assoluto dello z-score minore o uguale alla soglia di attenzione configurata e valore minore o uguale alla soglia di attenzione fissa del sensore, THE Motore_Anomalie SHALL impostare lo Stato_Macchina a `verde`.
6. THE Motore_Anomalie SHALL eseguire il rilevamento senza alcuna chiamata all'AMD_Token_Factory né ad altri servizi LLM, producendo per la stessa sequenza di Campioni e la stessa configurazione di soglie sempre gli stessi Stati_Macchina e gli stessi Allarmi, anche quando l'AMD_Token_Factory non è raggiungibile.
7. FOR ALL sequenze di Campioni con valori minori o uguali alle soglie di attenzione fisse e valore assoluto dello z-score minore o uguale alla soglia di attenzione configurata, THE Motore_Anomalie SHALL mantenere lo Stato_Macchina `verde` e generare zero Allarmi (invariante).
8. IF la finestra mobile di un sensore contiene meno di 60 Campioni precedenti oppure la loro deviazione standard è pari a zero, THEN THE Motore_Anomalie SHALL valutare il Campione solo rispetto alle soglie di attenzione e critica fisse del sensore, senza applicare le soglie sullo z-score.
9. IF un Campione ha valore non numerico o non finito, timestamp mancante, oppure identificativo macchina o sensore assente dalla Configurazione_Fabbrica attiva, THEN THE Motore_Anomalie SHALL scartare il Campione senza aggiungerlo alla finestra mobile, senza modificare lo Stato_Macchina e senza generare o aggiornare Allarmi, e SHALL registrare un avviso che indica il motivo dello scarto.
10. IF una configurazione delle soglie z-score ha soglia di attenzione maggiore o uguale alla soglia critica, oppure una delle due soglie fuori dall'intervallo 0,5–10,0, THEN THE Motore_Anomalie SHALL rifiutare la configurazione con un messaggio di errore che indica la soglia non valida e SHALL continuare a usare le soglie valide precedenti.

### Requisito 4: Contratto Allarme e flusso eventi in tempo reale

**User Story:** Come membro del team, voglio un contratto di tipo `Alarm` condiviso e un flusso eventi in tempo reale, così che i moduli Monitoraggio e Incidenti si integrino senza attriti.

#### Criteri di Accettazione

1. THE Contratto_Allarme SHALL definire come obbligatori i seguenti campi: identificativo (stringa non vuota, univoca tra gli Allarmi, massimo 64 caratteri), identificativo macchina (stringa non vuota presente nella Configurazione_Fabbrica attiva), identificativo sensore (stringa non vuota appartenente alla macchina indicata), valore (numero finito), z-score (numero finito), soglia superata (numero finito), gravità (esclusivamente `giallo` o `rosso`), timestamp di apertura (data e ora in formato ISO 8601 con fuso orario) e finestra degli ultimi Campioni (lista ordinata per timestamp crescente, da 1 a 60 Campioni dello stesso sensore indicato nell'Allarme).
2. WHEN il Motore_Anomalie genera o aggiorna un Allarme, THE FactoryPilot SHALL validare l'Allarme rispetto a tutti i vincoli del Contratto_Allarme definiti nel criterio 1 prima di inoltrarlo al modulo Incidenti.
3. FOR ALL Allarmi validi, la serializzazione JSON seguita dal parsing SHALL produrre un Allarme con valori identici all'originale per ogni campo, inclusi numero, ordine e valori dei Campioni della finestra (proprietà di round-trip).
4. WHEN cambia uno Stato_Macchina, viene generato o aggiornato un Allarme, oppure viene aggiornato un Incidente, THE Flusso_Eventi SHALL notificare l'evento a tutti i componenti sottoscritti entro 500 millisecondi, mantenendo per ciascuna macchina l'ordine di generazione degli eventi.
5. WHILE la scheda del browser è in background, THE Simulatore SHALL continuare a generare Campioni e, quando la scheda torna in primo piano, THE Flusso_Eventi SHALL notificare entro 2 secondi lo stato corrente di tutte le macchine e di tutti gli Incidenti aperti.
6. IF un Allarme non supera la validazione rispetto al Contratto_Allarme, THEN THE FactoryPilot SHALL scartare l'Allarme senza inoltrarlo al modulo Incidenti né al Flusso_Eventi, registrare un errore che indica l'identificativo dell'Allarme e il campo non valido, e lasciare invariati gli Incidenti esistenti.
7. IF una richiesta a un'API_Route_Inferenza fallisce per errore di rete, THEN THE FactoryPilot SHALL mostrare nell'interfaccia un indicatore che il servizio AI non è raggiungibile, continuando simulazione, rilevamento e Mappa_3D senza interruzioni.

### Requisito 5: Mappa 3D della fabbrica

**User Story:** Come operatore di linea, voglio vedere una mappa 3D semplice della fabbrica con lo stato delle macchine, così da capire a colpo d'occhio dove c'è un problema.

#### Criteri di Accettazione

1. WHEN la Mappa_3D viene caricata con una Configurazione_Fabbrica attiva contenente da 1 a 50 macchine, THE Mappa_3D SHALL rappresentare, entro 3 secondi, ogni macchina come modello low-poly nella posizione definita dal layout, mantenendo una frequenza di aggiornamento di almeno 30 fotogrammi al secondo durante l'interazione.
2. THE Mappa_3D SHALL rappresentare ogni collegamento a monte/valle definito nella Configurazione_Fabbrica attiva come una connessione visibile (nastro o linea) che unisce i modelli delle due macchine collegate, senza mostrare connessioni non definite nella configurazione.
3. WHEN il Flusso_Eventi notifica un cambio di Stato_Macchina, THE Mappa_3D SHALL colorare la macchina entro 2 secondi dalla ricezione dell'evento: verde per macchina operativa, giallo per macchina in stato di attenzione o degrado, rosso per macchina in guasto o ferma.
4. THE Mappa_3D SHALL permettere all'utente di ruotare la vista (trascinamento con tasto sinistro del mouse o con un dito), ingrandire e ridurre la vista (rotella del mouse o pizzico con due dita) e spostare la vista (trascinamento con tasto destro del mouse o con due dita), limitando lo zoom in modo che l'intero layout resti visualizzabile alla distanza massima e che la telecamera non scenda sotto il piano del pavimento della fabbrica.
5. WHEN l'utente seleziona una macchina sulla Mappa_3D tramite clic o tocco, THE FactoryPilot SHALL evidenziare la macchina selezionata e aprire entro 500 millisecondi il pannello di dettaglio della macchina con almeno il nome e lo Stato_Macchina corrente.
6. WHEN l'utente cambia la Configurazione_Fabbrica attiva, THE Mappa_3D SHALL rimuovere tutti i modelli e le connessioni della configurazione precedente, ridisegnare entro 3 secondi il layout corrispondente senza ricaricare la pagina e riportare la vista alla posizione iniziale che inquadra l'intero layout.
7. THE FactoryPilot SHALL fornire, accanto alla Mappa_3D, un elenco testuale di tutte le macchine della Configurazione_Fabbrica attiva con nome e Stato_Macchina espresso anche in forma testuale (non solo tramite colore), aggiornato entro 2 secondi da ogni cambio di Stato_Macchina, navigabile da tastiera e annunciato dal lettore di schermo, in cui la pressione del tasto Invio su una voce apre il pannello di dettaglio della macchina corrispondente.
8. IF il browser non supporta il rendering 3D o il caricamento della scena React Three Fiber fallisce, THEN THE FactoryPilot SHALL mostrare al posto della Mappa_3D un messaggio che indica l'impossibilità di visualizzare la mappa e SHALL mantenere disponibile e aggiornato l'elenco testuale delle macchine.
9. WHILE la simulazione è in pausa, THE Mappa_3D SHALL mostrare un indicatore visibile e testuale di simulazione in pausa, SHALL mantenere l'ultimo Stato_Macchina noto per ogni macchina e SHALL rimuovere l'indicatore entro 2 secondi dalla ripresa della simulazione.
10. IF una macchina della Configurazione_Fabbrica attiva non ha una posizione valida nel layout, THEN THE Mappa_3D SHALL omettere quella macchina dalla scena 3D senza interrompere il rendering delle altre macchine, e THE FactoryPilot SHALL segnalare la macchina come non posizionata nell'elenco testuale.

### Requisito 6: Dettaglio macchina

**User Story:** Come tecnico di manutenzione, voglio vedere i dati dei sensori e gli incidenti di una macchina, così da valutare la situazione prima di intervenire.

#### Criteri di Accettazione

1. WHEN il pannello di dettaglio della macchina viene aperto, THE pannello di dettaglio della macchina SHALL mostrare nome, tipo e Stato_Macchina della macchina e, per ciascun sensore definito nella Configurazione_Fabbrica attiva, il valore dell'ultimo Campione ricevuto con unità di misura, soglia di attenzione e soglia critica.
2. WHEN il Flusso_Eventi invia un nuovo Campione o un cambio di Stato_Macchina per la macchina visualizzata, THE pannello di dettaglio della macchina SHALL aggiornare il valore corrente del sensore e lo Stato_Macchina mostrati entro 2 secondi dalla ricezione dell'evento, senza ricaricare la pagina.
3. THE pannello di dettaglio della macchina SHALL mostrare, per ciascun sensore, un grafico dei Campioni con timestamp compreso negli ultimi 60 secondi (al massimo 60 punti, uno al secondo), con la soglia di attenzione e la soglia critica del sensore visibili come riferimenti; se sono disponibili meno di 60 secondi di Campioni, il grafico SHALL mostrare solo i Campioni disponibili.
4. WHEN il Flusso_Eventi invia un nuovo Campione per un sensore della macchina visualizzata, THE pannello di dettaglio della macchina SHALL aggiungere il punto al grafico del sensore e rimuovere i punti con timestamp più vecchio di 60 secondi entro 2 secondi dalla ricezione dell'evento.
5. THE pannello di dettaglio della macchina SHALL elencare gli Incidenti della macchina mostrando per ciascuno identificativo, stato (aperto o chiuso), Punteggio_Priorità e data/ora di apertura, con gli Incidenti aperti prima ordinati per Punteggio_Priorità decrescente, seguiti dai 20 Incidenti chiusi più recenti ordinati per data di chiusura decrescente.
6. WHEN il Flusso_Eventi invia un aggiornamento di un Incidente della macchina visualizzata, THE pannello di dettaglio della macchina SHALL aggiornare stato e Punteggio_Priorità dell'Incidente nell'elenco entro 2 secondi dalla ricezione dell'evento.
7. IF la macchina visualizzata non ha Incidenti aperti né chiusi, THEN THE pannello di dettaglio della macchina SHALL mostrare un messaggio indicante che non sono presenti Incidenti per la macchina.
8. WHILE la simulazione è in pausa, THE pannello di dettaglio della macchina SHALL mantenere visibili gli ultimi valori e grafici ricevuti e mostrare un'indicazione che la simulazione è in pausa.

### Requisito 7: Estrazione del manuale

**User Story:** Come tecnico di manutenzione, voglio che la diagnosi citi la pagina esatta del manuale, così da verificare rapidamente la fonte.

#### Criteri di Accettazione

1. WHEN viene fornito un manuale PDF valido da 1 a 500 pagine, THE Estrattore_Manuale SHALL produrre un Manuale_Markdown che contiene, per ogni pagina N del PDF (numerata da 1 in ordine crescente e senza salti), esattamente un marcatore `<!-- page: N -->` posto all'inizio del contenuto testuale di quella pagina, incluse le pagine senza testo, il cui contenuto risulta vuoto.
2. THE Estrattore_Manuale SHALL essere eseguibile come script da riga di comando in fase di sviluppo, salvando il Manuale_Markdown come file nel repository, così che l'applicazione su Vercel legga i manuali delle Configurazioni_Fabbrica di esempio senza estrazione a runtime.
3. WHEN lo script viene eseguito su un manuale PDF per il quale esiste già un Manuale_Markdown salvato, THE Estrattore_Manuale SHALL riutilizzare il file salvato senza eseguire una nuova estrazione, salvo richiesta esplicita di rigenerazione.
4. WHEN viene fornito un Manuale_Markdown, THE FactoryPilot SHALL ricavare un elenco di pagine, ordinato per numero di pagina crescente, in cui ogni elemento contiene il numero di pagina N (intero ≥ 1) e il testo compreso tra il marcatore `<!-- page: N -->` e il marcatore successivo, oppure la fine del file.
5. FOR ALL elenchi di pagine validi, ossia con numeri di pagina interi consecutivi a partire da 1 e testi che non contengono la sequenza `<!-- page:`, la generazione del Manuale_Markdown seguita dalla lettura dei marcatori SHALL produrre lo stesso elenco di numeri di pagina e testi, con testi identici a meno degli spazi bianchi iniziali e finali (proprietà di round-trip).
6. IF il PDF del manuale non contiene testo estraibile in nessuna pagina, THEN THE Estrattore_Manuale SHALL restituire un errore che indica che il manuale non è leggibile e SHALL NOT salvare alcun Manuale_Markdown.
7. IF il file fornito non è un PDF valido oppure supera le 500 pagine, THEN THE Estrattore_Manuale SHALL restituire un errore che indica il motivo del rifiuto e SHALL NOT salvare alcun Manuale_Markdown.
8. IF un Manuale_Markdown fornito non contiene alcun marcatore `<!-- page: N -->` oppure contiene numeri di pagina duplicati o non interi, THEN THE FactoryPilot SHALL restituire un errore che indica che il Manuale_Markdown non è valido, senza produrre un elenco di pagine parziale.

### Requisito 8: Agente di diagnosi

**User Story:** Come tecnico di manutenzione, voglio una diagnosi con causa probabile, pagina del manuale, confidenza, azione raccomandata e ricambi, così da ridurre il tempo tra allarme e intervento.

#### Criteri di Accettazione

1. WHEN viene creato un Incidente da un Allarme `rosso`, THE Agente_Diagnosi SHALL produrre una Diagnosi includendo nel prompt l'Allarme conforme al Contratto_Allarme, la finestra degli ultimi Campioni contenuta nell'Allarme, il Manuale_Markdown della macchina dell'Allarme e gli interventi simili (al massimo 3) selezionati dalla Memoria_Fabbrica.
2. THE Agente_Diagnosi SHALL richiedere all'AMD_Token_Factory una risposta in formato JSON conforme allo schema della Diagnosi, in cui `causa_probabile`, `citazione` e `azione_raccomandata` sono stringhe non vuote, `pagina_manuale` è un numero intero maggiore o uguale a 1, `confidenza` è un numero compreso tra 0 e 1 inclusi e `ricambi` è una lista di stringhe (eventualmente vuota).
3. IF la risposta dell'Agente_Diagnosi non è JSON valido o non è conforme allo schema della Diagnosi definito nel criterio 2, THEN THE FactoryPilot SHALL ripetere la richiesta all'AMD_Token_Factory esattamente una volta.
4. IF anche la risposta della richiesta ripetuta non è JSON valido o non è conforme allo schema della Diagnosi, THEN THE FactoryPilot SHALL registrare la Diagnosi dell'Incidente come non disponibile, applicare l'escalation al Responsabile e mantenere l'Incidente aperto con l'Allarme associato.
5. IF la `pagina_manuale` della Diagnosi non corrisponde ad alcun marcatore `<!-- page: N -->` presente nel Manuale_Markdown della macchina, THEN THE FactoryPilot SHALL impostare la `confidenza` della Diagnosi a 0 e contrassegnare la citazione come non verificata.
6. FOR ALL Diagnosi valide, la serializzazione JSON seguita dal parsing SHALL produrre una Diagnosi equivalente all'originale, con valori identici per tutti i campi `causa_probabile`, `pagina_manuale`, `citazione`, `confidenza`, `azione_raccomandata` e `ricambi` (proprietà di round-trip).
7. THE FactoryPilot SHALL effettuare al massimo 3 chiamate all'AMD_Token_Factory per Incidente, includendo la richiesta ripetuta del criterio 3 ed escludendo i ritentativi per errori 429 gestiti dal Client_LLM.
8. IF il limite di 3 chiamate per Incidente è raggiunto senza una Diagnosi valida, THEN THE FactoryPilot SHALL registrare la Diagnosi come non disponibile, applicare l'escalation al Responsabile e non effettuare ulteriori chiamate all'AMD_Token_Factory per quell'Incidente.
9. WHEN una Diagnosi valida viene associata a un Incidente, THE FactoryPilot SHALL mostrare al Tecnico causa probabile, citazione del manuale, numero di pagina, confidenza, azione raccomandata e ricambi e, se la citazione è contrassegnata come non verificata, un indicatore visibile di citazione non verificata.
10. IF la Diagnosi di un Incidente è registrata come non disponibile, THEN THE FactoryPilot SHALL mostrare al Tecnico, nella vista dell'Incidente, un'indicazione che la diagnosi AI non è disponibile e che l'Incidente è stato inoltrato al Responsabile.

### Requisito 9: Agente di sicurezza e regola di escalation

**User Story:** Come responsabile di manutenzione, voglio che i casi rischiosi o incerti arrivino sempre a me, così che l'AI non prenda decisioni pericolose da sola.

#### Criteri di Accettazione

1. WHEN una Diagnosi è disponibile per un Incidente, THE Agente_Sicurezza SHALL produrre, entro 30 secondi dalla disponibilità della Diagnosi, una Valutazione_Rischio usando un modello Gemma tramite l'AMD_Token_Factory, con `livello_rischio` uguale a uno tra `basso`, `medio` e `alto` e `motivazione` non vuota.
2. IF la risposta dell'Agente_Sicurezza non è conforme allo schema della Valutazione_Rischio (campo `livello_rischio` assente o diverso da `basso`, `medio` e `alto`, oppure campo `motivazione` assente o vuoto), THEN THE FactoryPilot SHALL considerare il `livello_rischio` come `alto` e registrare nel registro dell'Incidente che la Valutazione_Rischio non era conforme allo schema.
3. IF la Regola_Escalation riceve un Incidente con almeno una di queste condizioni: `livello_rischio` uguale ad `alto`, `confidenza` della Diagnosi strettamente inferiore alla Soglia_Confidenza, Diagnosi non disponibile, `codice_azione` diverso da `riduci_velocita`, `apri_ticket` e `pianifica_ispezione`, THEN THE Regola_Escalation SHALL richiedere l'intervento del Responsabile.
4. THE Regola_Escalation SHALL essere implementata come funzione deterministica nel codice Next.js/TypeScript che, a parità di Valutazione_Rischio, Diagnosi, Soglia_Confidenza e Livello_Autonomia in ingresso, restituisce sempre la stessa decisione, e la sua decisione SHALL prevalere su qualsiasi output contrario di un agente LLM.
5. THE Regola_Escalation SHALL richiedere l'intervento del Responsabile per ogni combinazione di Valutazione_Rischio, `confidenza`, `azione_raccomandata` e Livello_Autonomia (L0, L1, L2, L3) in cui il `livello_rischio` è `alto` oppure la `confidenza` è strettamente inferiore alla Soglia_Confidenza (invariante di sicurezza).
6. WHEN la Regola_Escalation richiede l'intervento del Responsabile, THE FactoryPilot SHALL mostrare l'Incidente nella coda di approvazione del Responsabile entro 2 secondi, con l'elenco di tutte le condizioni del criterio 3 che hanno causato l'escalation, e SHALL impedire qualsiasi esecuzione autonoma dell'azione raccomandata fino alla decisione del Responsabile.
7. IF l'Agente_Sicurezza non risponde entro 30 secondi oppure la chiamata all'AMD_Token_Factory fallisce, THEN THE FactoryPilot SHALL considerare il `livello_rischio` come `alto`, registrare nel registro dell'Incidente il fallimento della Valutazione_Rischio e sottoporre l'Incidente alla Regola_Escalation.
8. IF la `confidenza` della Diagnosi è assente, non numerica o fuori dall'intervallo da 0 a 1, THEN THE Regola_Escalation SHALL trattare la Diagnosi come non disponibile e richiedere l'intervento del Responsabile.

### Requisito 10: Livelli di autonomia configurabili

**User Story:** Come responsabile di produzione, voglio configurare il livello di autonomia dell'AI per tipo di macchina e tipo di azione, così da delegare solo i problemi minori e mantenere il controllo sui problemi importanti.

#### Criteri di Accettazione

1. THE Configurazione_Fabbrica SHALL associare esattamente un Livello_Autonomia, scelto tra i soli valori L0, L1, L2 e L3, a ogni coppia tipo di macchina e tipo di azione, e SHALL applicare il valore L0 a ogni coppia priva di un livello configurato esplicitamente.
2. WHILE il Livello_Autonomia applicabile è L0, THE Gestore_Autonomia SHALL mostrare l'azione raccomandata nell'interfaccia dell'Incidente solo come suggerimento testuale, senza creare bozze di azione e senza eseguire alcuna azione.
3. WHILE il Livello_Autonomia applicabile è L1, THE Gestore_Autonomia SHALL preparare la bozza dell'azione con i parametri precompilati e SHALL eseguire l'azione solo dopo l'avvio manuale da parte del Tecnico, senza alcuna esecuzione automatica.
4. WHILE il Livello_Autonomia applicabile è L2, THE Gestore_Autonomia SHALL mostrare al Responsabile un controllo di approvazione a singolo clic ed eseguire l'Azione_Whitelist solo dopo che il Responsabile ha attivato tale controllo.
5. WHILE il Livello_Autonomia applicabile è L3, IF la Regola_Escalation non richiede l'intervento del Responsabile, THEN THE Gestore_Autonomia SHALL eseguire l'Azione_Whitelist senza richiedere approvazione e SHALL mostrare al Responsabile una notifica entro 5 secondi dall'esecuzione, che indichi azione, macchina e Incidente; IF la Regola_Escalation richiede l'intervento del Responsabile, THEN THE Gestore_Autonomia SHALL applicare il comportamento previsto per L2.
6. THE Gestore_Autonomia SHALL limitare l'esecuzione con approvazione (L2) o autonoma (L3) alle Azioni_Whitelist `riduci_velocita`, `apri_ticket` e `pianifica_ispezione`, e SHALL applicare il comportamento previsto per L1 a qualsiasi azione non inclusa in tale elenco, indipendentemente dal Livello_Autonomia configurato.
7. WHEN il Gestore_Autonomia esegue un'azione, THE FactoryPilot SHALL registrare nel registro dell'Incidente una voce contenente azione, Livello_Autonomia applicato, motivazione, esito (riuscita o fallita), autore dell'approvazione o dell'avvio (Tecnico, Responsabile o Gestore_Autonomia) e timestamp.
8. WHEN il Responsabile annulla un'Azione_Whitelist eseguita autonomamente mentre l'Incidente è ancora aperto, THE FactoryPilot SHALL ripristinare lo stato della macchina e dell'Incidente precedente all'azione e SHALL registrare l'annullamento nel registro dell'Incidente con autore e timestamp.
9. WHEN il Responsabile salva un Livello_Autonomia modificato dall'interfaccia, THE FactoryPilot SHALL applicare il nuovo livello solo agli Incidenti creati dopo il salvataggio e SHALL mantenere il livello originario per gli Incidenti già aperti.
10. IF il Responsabile rifiuta o non approva un'Azione_Whitelist in stato L2, THEN THE Gestore_Autonomia SHALL lasciare l'azione non eseguita, mantenere invariato lo stato della macchina e registrare il rifiuto nel registro dell'Incidente con autore e timestamp.
11. IF l'esecuzione di un'azione da parte del Gestore_Autonomia fallisce, THEN THE FactoryPilot SHALL lasciare invariato lo stato precedente all'azione, mostrare al Responsabile un messaggio di errore che indichi l'azione fallita e la causa, e registrare l'esito fallito nel registro dell'Incidente.
12. IF il ripristino richiesto dall'annullamento di un'Azione_Whitelist non può essere completato, THEN THE FactoryPilot SHALL mostrare al Responsabile un messaggio di errore che indichi il mancato ripristino, mantenere lo stato corrente senza modifiche parziali e registrare il tentativo fallito nel registro dell'Incidente.

### Requisito 11: Approvazione umana e ordine di lavoro

**User Story:** Come responsabile di manutenzione, voglio approvare o rifiutare l'azione proposta e generare un ordine di lavoro, così che il tecnico sappia cosa fare.

#### Criteri di Accettazione

1. THE coda di approvazione SHALL mostrare tutti gli Incidenti aperti per cui la Regola_Escalation richiede l'intervento del Responsabile e che non sono stati ancora approvati, ordinati per Punteggio_Priorità decrescente, e SHALL mostrare per ogni Incidente: macchina, Diagnosi, Valutazione_Rischio, impatto economico, Percorso_Causale, fino a 3 interventi simili della Memoria_Fabbrica (oppure un'indicazione che non esistono interventi simili) e motivo dell'escalation.
2. WHEN il Responsabile approva un Incidente, THE FactoryPilot SHALL, entro 5 secondi, generare un Ordine_di_Lavoro con macchina, causa, azione, ricambi (oppure un'indicazione che non servono ricambi), priorità derivata dal livello_rischio della Valutazione_Rischio, assegnatario e riferimento alla pagina del Manuale_Markdown (oppure un'indicazione che il riferimento non è disponibile), togliere l'Incidente dalla coda di approvazione e inviare l'aggiornamento tramite il Flusso_Eventi.
3. WHEN il Responsabile rifiuta un Incidente inserendo una motivazione da 1 a 500 caratteri, THE FactoryPilot SHALL registrare il rifiuto con motivazione, Responsabile e data/ora, lasciare l'Incidente aperto e non generare alcun Ordine_di_Lavoro.
4. WHEN il Tecnico chiude un Ordine_di_Lavoro, THE FactoryPilot SHALL chiedere causa reale (da 1 a 500 caratteri), intervento eseguito (da 1 a 1000 caratteri) e durata dell'intervento in minuti (numero intero da 1 a 1440).
5. IF il Responsabile conferma un rifiuto con motivazione vuota o più lunga di 500 caratteri, THEN THE FactoryPilot SHALL bloccare il rifiuto, mostrare un messaggio di errore che indica il campo non valido e lasciare l'Incidente nella coda di approvazione senza modifiche.
6. IF il Tecnico conferma la chiusura con almeno un campo mancante o fuori dai limiti del criterio 4, THEN THE FactoryPilot SHALL bloccare la chiusura, indicare ogni campo non valido, conservare i valori già inseriti e lasciare l'Ordine_di_Lavoro aperto.
7. WHEN il Tecnico conferma la chiusura con tutti i campi validi, THE FactoryPilot SHALL salvare nella Memoria_Fabbrica causa reale, intervento eseguito, durata e data di chiusura, impostare l'Incidente come chiuso e inviare l'aggiornamento tramite il Flusso_Eventi entro 2 secondi.

### Requisito 12: Analisi della causa radice lungo la linea

**User Story:** Come tecnico di manutenzione, voglio che l'AI risalga la linea di produzione fino alla macchina che ha originato il problema, così da non riparare il sintomo invece della causa.

#### Criteri di Accettazione

1. WHEN viene creato un Incidente, THE Analizzatore_Causa_Radice SHALL esaminare tutte le macchine raggiungibili a monte della macchina in allarme, direttamente o indirettamente, seguendo i collegamenti a monte della Configurazione_Fabbrica attiva, e SHALL completare l'analisi entro 1 secondo dalla creazione dell'Incidente, prima dell'invocazione dell'Agente_Diagnosi.
2. WHEN una o più macchine a monte presentano Stato_Macchina `giallo` o `rosso` con un'anomalia iniziata prima di quella della macchina in allarme, THE Analizzatore_Causa_Radice SHALL indicare come causa radice la macchina a monte con l'anomalia iniziata per prima e SHALL registrare nell'Incidente il Percorso_Causale dalla causa radice alla macchina in allarme, dove l'inizio dell'anomalia di una macchina è il timestamp dell'ultima transizione del suo Stato_Macchina da `verde` a `giallo` o `rosso`.
3. FOR ALL Percorsi_Causali prodotti, THE Analizzatore_Causa_Radice SHALL produrre una sequenza senza macchine ripetute in cui ogni macchina è collegata direttamente a valle della precedente secondo la Configurazione_Fabbrica, la prima macchina è la causa radice e l'ultima macchina è la macchina in allarme (invariante).
4. IF nessuna macchina a monte presenta Stato_Macchina `giallo` o `rosso` con un'anomalia iniziata prima di quella della macchina in allarme, oppure la macchina in allarme non ha collegamenti a monte, THEN THE Analizzatore_Causa_Radice SHALL indicare come causa radice la macchina in allarme e SHALL produrre un Percorso_Causale composto dalla sola macchina in allarme.
5. IF due o più macchine a monte candidate hanno lo stesso timestamp di inizio anomalia, THEN THE Analizzatore_Causa_Radice SHALL indicare come causa radice la candidata con il maggior numero di collegamenti di distanza dalla macchina in allarme e, a parità di distanza, quella con identificativo minore in ordine lessicografico.
6. IF esistono più percorsi di collegamento tra la causa radice e la macchina in allarme, THEN THE Analizzatore_Causa_Radice SHALL produrre come Percorso_Causale quello con il minor numero di macchine e, a parità di lunghezza, quello la cui sequenza di identificativi precede in ordine lessicografico.
7. WHEN è disponibile un Percorso_Causale con più di una macchina, THE Mappa_3D SHALL evidenziare entro 2 secondi dalla ricezione dell'aggiornamento dell'Incidente sul Flusso_Eventi tutte le macchine del Percorso_Causale e i collegamenti tra macchine consecutive del Percorso_Causale come tracciato visivamente distinto dalle macchine e dai collegamenti non coinvolti, orientato dalla causa radice alla macchina in allarme.
8. WHEN il Percorso_Causale contiene una sola macchina, THE Mappa_3D SHALL evidenziare la sola macchina in allarme senza mostrare alcun tracciato.
9. WHEN l'Analizzatore_Causa_Radice ha prodotto il Percorso_Causale, THE Agente_Diagnosi SHALL ricevere nel prompt il Percorso_Causale con identificativo, nome e Stato_Macchina di ciascuna macchina e SHALL produrre la Diagnosi con `causa_probabile` e `azione_raccomandata` riferite alla macchina causa radice e con `pagina_manuale` e `citazione` tratte dal Manuale_Markdown associato alla macchina causa radice nella Configurazione_Fabbrica.
10. IF l'Analizzatore_Causa_Radice non riesce a completare l'analisi entro 1 secondo o incontra un errore, THEN THE Analizzatore_Causa_Radice SHALL indicare come causa radice la macchina in allarme con un Percorso_Causale composto dalla sola macchina in allarme, SHALL segnalare nell'Incidente che l'analisi della causa radice non è stata completata e SHALL consentire la prosecuzione della pipeline di diagnosi senza perdere i dati dell'Incidente.

### Requisito 13: Impatto economico e prioritizzazione

**User Story:** Come responsabile di produzione, voglio vedere quanto costa ogni incidente e quanto risparmio intervenendo subito, così da dare priorità in base all'impatto sul business.

#### Criteri di Accettazione

1. WHEN viene creato un Incidente, THE Calcolatore_Impatto SHALL calcolare entro 1 secondo, sull'insieme formato dalla macchina in allarme, dalle macchine del Percorso_Causale e da tutte le macchine a valle (dirette e indirette) della macchina in allarme secondo i collegamenti della Configurazione_Fabbrica, con ogni macchina contata una sola volta: (a) il costo del fermo al minuto come somma dei costi di fermo al minuto delle macchine dell'insieme; (b) i pezzi a rischio al minuto come massimo dei pezzi prodotti al minuto tra le macchine dell'insieme (in una linea in serie lo stesso pezzo attraversa tutte le macchine, quindi la somma conterebbe più volte lo stesso pezzo); (c) il risparmio stimato intervenendo subito come costo del fermo al minuto moltiplicato per un orizzonte di stima configurabile tra 1 e 1440 minuti, con valore predefinito 60 minuti.
2. THE Calcolatore_Impatto SHALL calcolare il Punteggio_Priorità come valore numerico maggiore o uguale a 0, ottenuto da una funzione deterministica del costo del fermo al minuto e del `livello_rischio`, in modo che gli stessi valori in ingresso producano sempre lo stesso Punteggio_Priorità.
3. FOR ALL coppie di Incidenti con lo stesso `livello_rischio`, THE Calcolatore_Impatto SHALL assegnare un Punteggio_Priorità maggiore o uguale all'Incidente con costo del fermo al minuto maggiore (proprietà metamorfica di monotonicità rispetto all'impatto).
4. FOR ALL coppie di Incidenti con lo stesso costo del fermo al minuto, THE Calcolatore_Impatto SHALL assegnare un Punteggio_Priorità maggiore o uguale all'Incidente con `livello_rischio` più alto, secondo l'ordine `basso` < `medio` < `alto` (proprietà metamorfica di monotonicità rispetto al rischio).
5. THE coda di approvazione SHALL ordinare gli Incidenti aperti per Punteggio_Priorità decrescente; a parità di Punteggio_Priorità, THE coda di approvazione SHALL mostrare prima l'Incidente creato meno di recente.
6. THE FactoryPilot SHALL mostrare per ogni Incidente, nella coda di approvazione e nel pannello di dettaglio della macchina, il costo del fermo al minuto e il risparmio stimato in euro con 2 cifre decimali, i pezzi a rischio al minuto come numero, l'orizzonte di stima usato in minuti e un'etichetta che indica che si tratta di stime basate sulla Configurazione_Fabbrica.
7. IF la Valutazione_Rischio di un Incidente non è ancora disponibile, THEN THE Calcolatore_Impatto SHALL calcolare il Punteggio_Priorità considerando il `livello_rischio` come `alto`.
8. WHEN la Valutazione_Rischio di un Incidente diventa disponibile, THE Calcolatore_Impatto SHALL ricalcolare il Punteggio_Priorità con il `livello_rischio` ricevuto e THE coda di approvazione SHALL aggiornare l'ordinamento entro 2 secondi.

### Requisito 14: Metriche di miglioramento misurabili

**User Story:** Come responsabile di produzione, voglio metriche chiare di miglioramento, così da dimostrare il valore del prodotto in tempo e costi.

#### Criteri di Accettazione

1. WHEN una Diagnosi diventa disponibile per un Incidente, THE FactoryPilot SHALL registrare per quell'Incidente il tempo allarme→diagnosi, ossia i secondi interi trascorsi tra il timestamp di apertura del primo Allarme dell'Incidente e il timestamp in cui la Diagnosi è disponibile, con valore minimo 0.
2. WHEN viene registrato un nuovo tempo allarme→diagnosi, THE Pannello_Metriche SHALL mostrare entro 2 secondi il tempo medio allarme→diagnosi in secondi con una cifra decimale, calcolato su tutti gli Incidenti con Diagnosi disponibile della Configurazione_Fabbrica attiva, affiancato dal tempo di ricerca manuale di riferimento in secondi definito nella Configurazione_Fabbrica attiva e dalla differenza tra i due valori.
3. WHEN viene registrato un nuovo tempo allarme→diagnosi, THE Pannello_Metriche SHALL mostrare entro 2 secondi il fermo stimato evitato in minuti con una cifra decimale, calcolato come somma per ogni Incidente con Diagnosi disponibile di (tempo di ricerca manuale di riferimento − tempo allarme→diagnosi) con valore minimo 0 per Incidente, e il risparmio stimato in euro arrotondato all'euro, calcolato come somma per ogni Incidente del fermo stimato evitato moltiplicato per il costo del fermo al minuto stimato dal Calcolatore_Impatto, entrambi con l'indicazione che si tratta di stime basate sulla Configurazione_Fabbrica.
4. WHEN un Incidente della Configurazione_Fabbrica attiva cambia stato, THE Pannello_Metriche SHALL mostrare entro 2 secondi il numero di Incidenti per i quali il Gestore_Autonomia ha eseguito un'Azione_Whitelist senza che la Regola_Escalation abbia richiesto l'intervento del Responsabile, e il numero di Incidenti per i quali la Regola_Escalation ha richiesto l'intervento del Responsabile, contando ogni Incidente al massimo una volta per ciascun contatore.
5. IF la Diagnosi di un Incidente è registrata come non disponibile, THEN THE FactoryPilot SHALL escludere quell'Incidente dal calcolo del tempo medio allarme→diagnosi, del fermo stimato evitato e del risparmio stimato, e conteggiarlo tra gli Incidenti scalati al Responsabile.
6. IF nella Configurazione_Fabbrica attiva non esistono Incidenti con Diagnosi disponibile, THEN THE Pannello_Metriche SHALL mostrare tempo medio allarme→diagnosi, fermo stimato evitato e risparmio stimato con l'indicazione "nessun dato" al posto di un valore numerico, e mostrare i due contatori di Incidenti con valore 0.
7. IF la Configurazione_Fabbrica attiva non definisce il tempo di ricerca manuale di riferimento, THEN THE Pannello_Metriche SHALL mostrare il tempo medio allarme→diagnosi senza confronto, mostrare fermo stimato evitato e risparmio stimato con un messaggio che indica la mancanza del valore di riferimento, e continuare a mostrare i contatori di Incidenti.

### Requisito 15: Memoria di fabbrica

**User Story:** Come tecnico di manutenzione, voglio che l'AI ricordi come sono stati risolti i problemi simili in passato, così da applicare subito la soluzione che ha funzionato.

#### Criteri di Accettazione

1. WHEN il Tecnico chiude un Ordine_di_Lavoro con causa reale (da 1 a 500 caratteri), intervento eseguito (da 1 a 1000 caratteri) e durata espressa come numero intero di minuti compreso tra 1 e 1440, THE Memoria_Fabbrica SHALL salvare un intervento con macchina, tipo di macchina, sensori coinvolti nell'Incidente di origine, causa reale, intervento eseguito, durata e data di chiusura.
2. WHEN viene creato un Incidente, THE FactoryPilot SHALL selezionare dalla Memoria_Fabbrica, inclusi gli interventi di esempio, al massimo 3 interventi della stessa macchina o dello stesso tipo di macchina che abbiano almeno un sensore coinvolto in comune con l'Incidente, ordinati per data di chiusura dalla più recente alla meno recente.
3. IF la selezione dalla Memoria_Fabbrica restituisce da 1 a 3 interventi, THEN THE FactoryPilot SHALL mostrare nella Diagnosi una citazione per ciascun intervento selezionato con data (giorno, mese e anno), causa reale, intervento eseguito e durata in minuti (ad esempio "successo il 3 ottobre 2026, risolto sostituendo il cuscinetto in 40 minuti"), indicando per gli interventi di esempio l'etichetta di dato di esempio.
4. WHEN la pagina viene ricaricata, THE Memoria_Fabbrica SHALL rendere disponibili tutti gli interventi salvati in precedenza (su Evolus oppure, in assenza di Evolus, nel `localStorage` dello stesso browser), con lo stesso numero di interventi e gli stessi valori di tutti i campi.
10. WHERE Evolus è configurato, THE Adattatore_Memoria SHALL recuperare gli interventi simili tramite ricerca semantica sulla descrizione dell'Incidente (macchina, tipo, sensori, sintomi), filtrata come nel criterio 2, e SHALL usare la chiave Evolus esclusivamente lato server.
11. IF Evolus non risponde entro 5 secondi o restituisce un errore, THEN THE Adattatore_Memoria SHALL usare l'archivio locale e THE FactoryPilot SHALL proseguire la Diagnosi senza bloccarsi.
5. THE FactoryPilot SHALL includere nella Memoria_Fabbrica almeno 3 interventi storici di esempio relativi alle macchine della demo, ciascuno contrassegnato come dato di esempio e visibile con tale etichetta in ogni punto dell'interfaccia in cui viene mostrato.
6. IF il Tecnico tenta di chiudere un Ordine_di_Lavoro con causa reale vuota o oltre 500 caratteri, intervento eseguito vuoto o oltre 1000 caratteri, oppure con durata non intera o fuori dall'intervallo 1–1440 minuti, THEN THE FactoryPilot SHALL rifiutare la chiusura, mostrare un messaggio di errore che indica ogni campo non valido, mantenere l'Ordine_di_Lavoro aperto e conservare i valori già inseriti.
7. IF la selezione dalla Memoria_Fabbrica non restituisce alcun intervento, THEN THE FactoryPilot SHALL mostrare nella Diagnosi l'indicazione che non esistono interventi simili e completare la Diagnosi senza citazioni di interventi passati.
8. IF il salvataggio di un intervento nella Memoria_Fabbrica fallisce, THEN THE FactoryPilot SHALL mostrare al Tecnico un messaggio di errore che indica il mancato salvataggio, mantenere l'Ordine_di_Lavoro aperto e conservare i valori inseriti per permettere un nuovo tentativo.
9. WHEN l'utente preme il comando "Ripristina demo", THE Memoria_Fabbrica SHALL eliminare gli interventi salvati dall'utente e ripristinare i soli interventi di esempio.

### Requisito 16: Onboarding in 5 minuti

**User Story:** Come responsabile di produzione, voglio caricare il manuale e la lista sensori e ottenere una configurazione della fabbrica pronta, così da adottare il prodotto senza progetti di integrazione lunghi.

#### Criteri di Accettazione

1. WHEN l'utente carica un manuale PDF di dimensione non superiore a 20 MB (il cui testo viene estratto nel browser e inviato all'API_Route_Inferenza in forma testuale, entro 4 MB di corpo richiesta) e una lista sensori in formato CSV di dimensione non superiore a 1 MB contenente da 1 a 500 righe di dati, THE Modulo_Onboarding SHALL generare tramite l'AMD_Token_Factory una bozza di Configurazione_Fabbrica che include, per ogni identificativo macchina distinto presente nel CSV, una macchina con i relativi sensori, una soglia proposta per ogni sensore, i collegamenti a monte e a valle e la posizione nel layout della Mappa_3D.
2. WHEN il Modulo_Onboarding genera una bozza, THE Parser_Configurazione SHALL validare la bozza rispetto allo schema della Configurazione_Fabbrica, all'esistenza degli identificativi macchina referenziati nei collegamenti e all'assenza di cicli, e THE Modulo_Onboarding SHALL mostrare all'utente solo bozze che superano la validazione.
3. IF la bozza generata non supera la validazione del Parser_Configurazione, THEN THE Modulo_Onboarding SHALL ripetere la generazione esattamente una volta includendo gli errori di validazione nel prompt e, in caso di nuovo fallimento, mostrare all'utente l'elenco degli errori con il percorso del campo non valido e il motivo, mantenendo invariata la Configurazione_Fabbrica attiva.
4. IF il CSV della lista sensori non contiene le colonne obbligatorie (identificativo macchina, nome sensore, unità di misura), THEN THE Modulo_Onboarding SHALL restituire un errore che elenca le colonne mancanti senza effettuare alcuna chiamata all'AMD_Token_Factory.
5. WHEN l'utente conferma una bozza valida, THE FactoryPilot SHALL sostituire la Configurazione_Fabbrica attiva con la nuova Configurazione_Fabbrica e mostrare entro 10 secondi la Mappa_3D contenente tutte e sole le macchine della nuova configurazione.
6. WHILE una bozza è visualizzata e non ancora confermata, THE Modulo_Onboarding SHALL permettere all'utente di modificare i valori delle soglie dei sensori e di aggiungere o rimuovere collegamenti a monte e a valle tra macchine della bozza.
7. WHEN l'utente completa il caricamento di entrambi i file, THE Modulo_Onboarding SHALL mostrare la bozza validata oppure l'elenco degli errori entro 5 minuti (300 secondi), ritentativi inclusi.
8. IF il manuale caricato non è un PDF leggibile, il file della lista sensori non è un CSV analizzabile, oppure uno dei file supera il limite di dimensione o di righe indicato, THEN THE Modulo_Onboarding SHALL rifiutare il caricamento con un errore che indica il file e il motivo del rifiuto, senza effettuare alcuna chiamata all'AMD_Token_Factory.
9. IF la generazione non si completa entro 300 secondi oppure una chiamata all'AMD_Token_Factory fallisce dopo i ritentativi del Client_LLM, THEN THE Modulo_Onboarding SHALL interrompere la generazione, mostrare un errore che indica che la generazione automatica non è disponibile e mantenere invariata la Configurazione_Fabbrica attiva.
10. IF l'utente conferma una bozza modificata che non supera la validazione del Parser_Configurazione, THEN THE Modulo_Onboarding SHALL bloccare l'attivazione, mostrare gli errori con il percorso del campo non valido e il motivo e conservare le modifiche dell'utente nella bozza.

### Requisito 17: Client LLM su infrastruttura AMD

**User Story:** Come sviluppatore del team, voglio un client unico e robusto per l'AMD Token Factory, così da rispettare i limiti della chiave condivisa e mantenere la chiave al sicuro.

#### Criteri di Accettazione

1. THE Client_LLM SHALL eseguire tutte le chiamate di inferenza dell'Agente_Diagnosi, dell'Agente_Sicurezza e del Modulo_Onboarding tramite l'AMD_Token_Factory con API compatibile OpenAI, senza alcuna chiamata di inferenza verso altri fornitori.
2. THE Client_LLM SHALL leggere la chiave API esclusivamente da variabili d'ambiente lato server di Next.js configurate su Vercel (senza prefisso `NEXT_PUBLIC_`), non accessibili al codice eseguito nel browser.
3. THE FactoryPilot SHALL mantenere la chiave API assente da qualsiasi risposta HTTP, bundle client, evento del Flusso_Eventi e voce di log prodotta dal Client_LLM.
4. WHEN un'istanza dell'API_Route_Inferenza riceve la prima richiesta, THE Client_LLM SHALL ottenere l'elenco dei modelli disponibili tramite `GET /v1/models` entro un timeout di 10 secondi, memorizzarlo per al massimo 10 minuti nell'istanza e selezionare, per ciascun agente, il modello configurato se presente nell'elenco.
5. IF un modello configurato non è presente nell'elenco dei modelli disponibili, THEN THE Client_LLM SHALL registrare un avviso che identifica l'agente e il modello mancante e usare il modello alternativo configurato per quell'agente; se anche il modello alternativo è assente, THE Client_LLM SHALL considerare l'agente non disponibile e applicare il comportamento del criterio 10 a ogni sua richiesta.
6. THE Orchestratore_Incidenti SHALL limitare le richieste dal browser verso le API_Route_Inferenza a un massimo di 4 richieste concorrenti e 20 richieste in qualsiasi finestra mobile di 60 secondi, mettendo in attesa in ordine di arrivo le richieste eccedenti invece di inviarle o scartarle.
7. IF l'AMD_Token_Factory risponde con stato 429, THEN THE Client_LLM SHALL attendere il tempo indicato dall'intestazione `Retry-After` quando presente (limitato a un massimo di 60 secondi), altrimenti un ritardo esponenziale di 1, 2, 4, 8 e 16 secondi per i ritentativi successivi, fino a un massimo di 5 ritentativi per richiesta, conteggiando ogni ritentativo nei limiti del criterio 6.
8. THE Client_LLM SHALL omettere `reasoning_effort` nelle richieste dell'Agente_Diagnosi e del Modulo_Onboarding al modello DeepSeek-V4-Flash (che senza il parametro non attiva il ragionamento, con latenza prevedibile) e SHALL inviare `reasoning_effort: none` al modello alternativo Qwen3.8-Flash-Next (che altrimenti ragiona per default), SHALL omettere `reasoning_effort` nelle richieste a modelli Gemma (che accettano solo on/off) e SHALL non inviare mai il parametro `thinking` né `reasoning.enabled`.
9. WHEN una chiamata all'AMD_Token_Factory termina, con successo o con errore, THE Client_LLM SHALL registrare nel log lato server l'agente chiamante, il modello usato, la latenza in millisecondi, i token di input, i token di output (zero se non restituiti) e l'esito della chiamata.
10. IF una chiamata all'AMD_Token_Factory fallisce dopo l'esaurimento dei ritentativi, THEN THE FactoryPilot SHALL applicare l'escalation al Responsabile, mostrare nell'interfaccia un indicatore che l'analisi AI non è disponibile per l'evento interessato e non mostrare alcun risultato AI parziale per quella richiesta.
11. IF la chiamata `GET /v1/models` fallisce o supera il timeout di 10 secondi, THEN THE Client_LLM SHALL registrare un avviso, proseguire con la richiesta e usare i modelli configurati per ciascun agente senza verifica di disponibilità.
12. IF una chiamata di inferenza non riceve risposta completa entro 25 secondi, oppure l'AMD_Token_Factory risponde con stato 5xx o si verifica un errore di rete, THEN THE Client_LLM SHALL ritentare la richiesta con lo stesso ritardo esponenziale e lo stesso massimo di 5 ritentativi del criterio 7, mentre per gli altri stati di errore 4xx diversi da 429 SHALL considerare la chiamata fallita senza ritentativi.
13. IF la variabile d'ambiente contenente la chiave API è assente o vuota quando l'API_Route_Inferenza riceve una richiesta, THEN THE Client_LLM SHALL registrare un errore che indica la chiave mancante senza esporne alcun valore, non eseguire alcuna chiamata all'AMD_Token_Factory e applicare il comportamento del criterio 10 a ogni richiesta di inferenza, salvo quando la Modalità_Replay è attiva.
14. THE API_Route_Inferenza SHALL dichiarare runtime Node e una durata massima di esecuzione compatibile con il limite del piano Vercel in uso; IF il tempo residuo dell'esecuzione non basta per un ulteriore ritentativo, THEN THE API_Route_Inferenza SHALL restituire al browser un errore ritentabile con il ritardo suggerito, e THE Orchestratore_Incidenti SHALL ripetere la richiesta dopo tale ritardo nel rispetto del criterio 6.

### Requisito 18: Modalità replay per la demo

**User Story:** Come presentatore della demo, voglio poter riprodurre risposte registrate, così che la demo funzioni anche se l'API è lenta o non disponibile.

#### Criteri di Accettazione

1. WHILE l'applicazione è eseguita in ambiente di sviluppo locale, la Modalità_Replay è disattivata e la registrazione è attiva, WHEN il Client_LLM riceve una risposta completata con successo dall'AMD_Token_Factory, THE Client_LLM SHALL salvare in un file JSON del repository la coppia richiesta/risposta indicizzata dall'hash della richiesta, insieme all'identificativo dell'agente e allo scenario di guasto, sovrascrivendo l'eventuale registrazione esistente con lo stesso hash e senza salvare le risposte terminate con errore o timeout.
2. WHILE la Modalità_Replay è attiva, WHEN il Client_LLM riceve una richiesta, THE Client_LLM SHALL restituire entro 1 secondo la risposta registrata il cui hash corrisponde a quello della richiesta, senza effettuare alcuna chiamata all'AMD_Token_Factory, dove due richieste con contenuto identico producono sempre lo stesso hash.
3. IF in Modalità_Replay non esiste una risposta registrata con l'hash della richiesta, THEN THE Client_LLM SHALL restituire la risposta registrata più recente dello stesso agente per lo stesso scenario di guasto, senza effettuare alcuna chiamata all'AMD_Token_Factory.
4. WHILE la Modalità_Replay è attiva, THE FactoryPilot SHALL mostrare un indicatore con il testo "Replay" in ogni schermata dell'interfaccia, facendolo comparire entro 1 secondo dall'attivazione e rimuovendolo entro 1 secondo dalla disattivazione.
5. WHEN la pagina viene caricata, THE FactoryPilot SHALL impostare lo stato iniziale della Modalità_Replay in base al valore della variabile d'ambiente dedicata, considerandola disattivata se la variabile è assente o ha un valore non riconosciuto.
6. WHEN il presentatore aziona l'interruttore della Modalità_Replay nell'interfaccia, THE FactoryPilot SHALL invertire lo stato della Modalità_Replay per la sessione del browser corrente, inviandolo come parametro di ogni richiesta alle API_Route_Inferenza a partire dalla richiesta successiva, senza interrompere le richieste già in corso.
7. IF in Modalità_Replay non esiste alcuna risposta registrata leggibile né per l'hash della richiesta né per lo stesso agente e scenario di guasto, oppure il file di registrazione è illeggibile o malformato, THEN THE Client_LLM SHALL restituire un errore che indica l'assenza della registrazione, senza chiamare l'AMD_Token_Factory, e THE FactoryPilot SHALL mostrare un messaggio di errore all'utente mantenendo invariato lo stato corrente della simulazione.
8. WHILE l'applicazione è eseguita su Vercel, THE Client_LLM SHALL leggere le registrazioni in sola lettura dai file JSON inclusi nel deploy, senza scrivere su disco.

### Requisito 19 (Opzionale): Ispezione visiva con Gemma

**User Story:** Come operatore di linea, voglio caricare la foto di un pezzo difettoso, così che l'AI la includa nella diagnosi.

#### Criteri di Accettazione

1. WHERE l'ispezione visiva è abilitata, WHEN l'utente carica una foto valida di un pezzo in un Incidente aperto, THE FactoryPilot SHALL inviare la foto a un modello Gemma multimodale tramite l'AMD_Token_Factory e mostrare un indicatore di elaborazione nell'Incidente fino alla risposta o al timeout di 30 secondi.
2. WHERE l'ispezione visiva è abilitata, IF il file caricato non è un'immagine JPEG o PNG di dimensione inferiore a 5 MB, THEN THE FactoryPilot SHALL rifiutare il file senza inviarlo all'AMD_Token_Factory e mostrare un messaggio che indica i formati e la dimensione ammessi.
3. WHERE l'ispezione visiva è abilitata, WHEN il modello Gemma restituisce la descrizione del difetto entro 30 secondi, THE FactoryPilot SHALL allegare all'Incidente la descrizione testuale e la miniatura della foto, visibili nel dettaglio dell'Incidente.
4. WHERE l'ispezione visiva è abilitata, WHEN viene generata o rigenerata la diagnosi di un Incidente con almeno una descrizione del difetto allegata, THE FactoryPilot SHALL includere tutte le descrizioni allegate tra gli input della diagnosi e indicare nella diagnosi che è stata usata l'ispezione visiva.
5. WHERE l'ispezione visiva è abilitata, IF la chiamata al modello Gemma fallisce o supera i 30 secondi, THEN THE FactoryPilot SHALL mostrare un messaggio di errore che indica che l'analisi della foto non è disponibile, lasciare invariati i dati esistenti dell'Incidente e permettere all'utente di ricaricare la foto.
6. WHERE l'ispezione visiva non è abilitata, THE FactoryPilot SHALL nascondere il controllo di caricamento foto negli Incidenti.

### Requisito 20 (Opzionale): Nota vocale del tecnico

**User Story:** Come tecnico di manutenzione, voglio dettare la chiusura dell'intervento a voce, così da non dover scrivere con le mani occupate.

#### Criteri di Accettazione

1. WHERE la nota vocale è abilitata, WHEN il Tecnico termina la registrazione di una nota vocale alla chiusura di un Ordine_di_Lavoro, THE FactoryPilot SHALL trascrivere la nota con il modello MiMo tramite l'AMD_Token_Factory e precompilare i campi causa reale, intervento eseguito e durata (in minuti, numero intero da 1 a 1440) entro 15 secondi dal termine della registrazione.
2. WHERE la nota vocale è abilitata, WHEN la registrazione raggiunge i 120 secondi, THE FactoryPilot SHALL interromperla automaticamente.
3. WHERE la nota vocale è abilitata, WHILE i campi precompilati sono visualizzati e non ancora confermati, THE FactoryPilot SHALL permettere al Tecnico di modificare ciascun campo e SHALL salvare l'intervento nella Memoria_Fabbrica solo dopo la conferma esplicita del Tecnico.
4. WHERE la nota vocale è abilitata, IF la trascrizione non riesce o l'AMD_Token_Factory non risponde entro 15 secondi, THEN THE FactoryPilot SHALL mostrare un messaggio di errore che indica che la trascrizione non è riuscita, lasciare vuoti i campi per la compilazione manuale e mantenere aperto l'Ordine_di_Lavoro senza salvare nulla nella Memoria_Fabbrica.
5. WHERE la nota vocale è abilitata, IF uno tra causa reale, intervento eseguito o durata non si può ricavare dalla trascrizione, THEN THE FactoryPilot SHALL lasciare vuoto quel campo, segnalarlo come da compilare a mano e bloccare la conferma finché tutti e tre i campi non sono compilati.

### Requisito 21 (Opzionale): Pagina benchmark dei modelli

**User Story:** Come giudice dell'hackathon, voglio vedere latenza e costo per modello, così da capire l'uso dell'infrastruttura AMD.

#### Criteri di Accettazione

1. WHERE la pagina benchmark è abilitata, WHEN un utente apre la pagina benchmark, THE FactoryPilot SHALL mostrare una riga per ciascun modello con almeno 1 chiamata completata con successo registrata dal Client_LLM, contenente: numero di chiamate, latenza media in millisecondi, latenza al 95° percentile in millisecondi, token medi per chiamata (input + output, arrotondati all'intero) e costo stimato per Incidente in USD con 4 cifre decimali.
2. WHERE la pagina benchmark è abilitata, THE FactoryPilot SHALL calcolare il costo stimato per Incidente di un modello come il costo totale delle sue chiamate registrate (token × tariffa per token configurata per quel modello) diviso per il numero di Incidenti distinti con almeno 1 chiamata a quel modello.
3. WHERE la pagina benchmark è abilitata, IF il Client_LLM non ha registrato alcuna chiamata completata con successo, THEN THE FactoryPilot SHALL mostrare un messaggio che indica l'assenza di dati di benchmark, al posto di righe con valori pari a zero.
4. WHERE la pagina benchmark è abilitata, IF per un modello non è configurata una tariffa per token, THEN THE FactoryPilot SHALL mostrare il costo stimato per Incidente di quel modello come non disponibile e continuare a mostrare le altre metriche del modello.
