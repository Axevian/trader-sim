# Simulatore Trader

Simulatore di trading **speculativo** su criptovalute, con **prezzi reali di Kraken** e **soldi virtuali**.
Ogni 4 ore scansiona il mercato, cerca i titoli che stanno esplodendo, entra con tutto il capitale, esce con stop mobile o stop temporale e reinveste i guadagni.
Quando il capitale raggiunge il traguardo (es. da 100 € a 1.000 €) matura un compenso.

- **Zero token e zero costi:** solo matematica, eseguita da GitHub Actions. Il cruscotto è pubblicato su GitHub Pages.
- **Nessun collegamento a conti reali:** non ci sono chiavi API. Le operazioni le replichi tu a mano sul tuo conto Kraken.
- **Non è una consulenza finanziaria.** I risultati simulati o passati non garantiscono quelli futuri.

---

## 1. Messa in funzione (circa 10 minuti)

1. **Crea un repository** su GitHub, per esempio `trader-sim`, e caricaci tutti i file di questa cartella mantenendo la struttura (`engine/`, `docs/`, `.github/workflows/`, `config.json`…).
   > Con il piano gratuito GitHub Pages richiede un repository **pubblico**: il cruscotto e lo storico delle operazioni saranno visibili a chiunque abbia il link. Non contengono dati personali né chiavi.
2. **Permessi delle esecuzioni automatiche:** *Settings → Actions → General → Workflow permissions →* **Read and write permissions** → Save.
3. **Pubblica il cruscotto:** *Settings → Pages → Build and deployment → Source:* **Deploy from a branch** → Branch `main`, cartella **/docs** → Save.
   Dopo un minuto il cruscotto sarà su `https://<tuo-utente>.github.io/<nome-repo>/`.
4. **Primo test sul passato:** *Actions →* **Test sul passato** *→ Run workflow*. Ci mette 2-3 minuti.
5. **Prima elaborazione:** *Actions →* **Simulatore (ogni 4 ore)** *→ Run workflow*. Da qui in poi parte da solo ogni 4 ore.

Per ricominciare da zero la simulazione dal vivo basta cancellare il file `docs/data/state.json` dal repository.

---

## 2. Come ragiona

| Fase | Regola (modificabile in `config.json`) |
|---|---|
| **Universo** | Coppie in EUR su Kraken, esclusi stablecoin e valute. I 60 titoli più scambiati con almeno 250.000 € di volume nelle 24 ore |
| **Filtro di mercato** | Nuovi acquisti solo se Bitcoin è sopra la sua media di 120 candele (~20 giorni). Altrimenti resta in liquidità |
| **Segnale di acquisto** | Tutti insieme: rottura del massimo delle ultime 84 candele (14 giorni), prezzo sopra la media a 50 con la media a 20 sopra quella a 50, volume delle ultime 24 ore almeno 2 volte la media, RSI sotto 85, rendimento a 7 giorni migliore di Bitcoin, liquidità minima |
| **Classifica** | Punteggio = forza relativa contro Bitcoin + esplosione del volume. Vince il più alto |
| **Dimensione** | 1 posizione alla volta con tutto il capitale (`maxPositions`) |
| **Stop iniziale** | 2 × la volatilità media (ATR), tra il 5% e il 15% sotto il prezzo d'ingresso |
| **Stop mobile** | Massimo raggiunto meno 3 × ATR. Sale soltanto e viene aggiornato ogni 4 ore |
| **Stop temporale** | Se dopo 12 candele (2 giorni) non guadagna almeno il 3%, chiude e passa avanti |
| **Costi** | Commissione 0,40% per lato + slippage 0,5% per lato. Se il prezzo è già oltre il 2% dal segnale, l'operazione viene saltata |
| **Traguardi** | Al raggiungimento di 10 volte il capitale di partenza, compenso del 10% del traguardo. Il nuovo traguardo è 10 volte il capitale rimasto |
| **Fallimento** | Se il capitale scende sotto 20 €, il tentativo è chiuso e si riparte da 100 € (contando il capitale aggiuntivo usato) |

---

## 3. Come replicare le operazioni sul tuo conto

Apri il cruscotto dopo ogni aggiornamento, alle 01, 05, 09, 13, 17 e 21 ora italiana (un'ora più tardi con l'ora legale). Il riquadro **"Cosa fare ora"** ha un pulsante **Copia**.

- **COMPRA:** compra l'importo indicato, ma **solo se il prezzo è sotto il limite "non entrare sopra"**. Subito dopo imposta su Kraken un **ordine stop-loss** al livello dello stop iniziale.
- **MANTIENI / alza lo stop:** sposta il tuo ordine stop-loss al nuovo livello. Lo stop si alza soltanto, non si abbassa mai.
- **VENDI:** se lo stop era impostato è già scattato da solo. Se invece è uno stop temporale, vendi a mercato.
- **TRAGUARDO:** metti da parte il compenso indicato.

Con lo stop-loss impostato su Kraken sei protetto anche quando non guardi il cruscotto: è proprio ciò che la simulazione presuppone.

---

## 4. Leggere il cruscotto

- **Progresso verso il traguardo:** su scala moltiplicativa. Passare da 100 a 316 € è già metà del percorso verso 1.000 €.
- **Previsore:** rimescola i rendimenti delle operazioni reali (test sul passato + dal vivo) in 5.000 futuri possibili. Stima la probabilità di arrivare al traguardo prima di fallire e il tempo tipico. Con meno di 30 operazioni è molto incerto.
- **Scanner:** i 15 titoli più forti del momento, con le spunte dei filtri superati, la colonna "Cosa manca" e il perché di ogni valore.
- **Diario delle decisioni:** tutte le decisioni con il loro perché, filtrabili per tipo.
- **Test sul passato:** stessa logica applicata agli ultimi ~120 giorni (Kraken fornisce al massimo 720 candele da 4 ore), confrontata con "compra e tieni" Bitcoin.

---

## 5. Il perché di ogni scelta e come correggere il tiro

Ogni decisione ha un pulsante **"Perché?"** con il ragionamento completo, scritto nel momento della scelta:

| Decisione | Cosa spiega |
|---|---|
| **COMPRA** | Stato del mercato (Bitcoin rispetto alla sua media), valore misurato di ogni filtro contro la sua soglia, perché quel titolo e non le alternative (punteggio), importo, stop iniziale calcolato dalla volatilità, stop mobile e stop temporale |
| **VENDI** | Quale regola è scattata e a che prezzo, massimo guadagno toccato, punto peggiore, durata e una **diagnosi** automatica |
| **Alza lo stop / MANTIENI** | Nuovo massimo, nuovo stop, risultato se scattasse ora, tempo rimasto prima dello stop temporale |
| **Nessuna operazione / ATTESA / SALTATO** | Perché non ha comprato e quali titoli ci sono andati vicino ("mancava solo il volume: 1,6× contro 2×") |

Ogni decisione riporta anche la **versione delle regole** (un codice di 6 caratteri calcolato da `config.json`). Quando cambi un parametro, il diario registra la riga "Regole cambiate" con il dettaglio (es. `entry.volumeRatioMin: 2 → 2.5`): sai sempre quali risultati appartengono a quali regole, senza dover cancellare la storia.

**Diagnosi delle operazioni chiuse:**

| Diagnosi | Significato | Leva possibile |
|---|---|---|
| falsa rottura | Non è mai salito oltre +2% ed è finito allo stop | Segnale più severo (`entry.volumeRatioMin`, `entry.breakoutLookback`) |
| guadagno restituito | Era oltre +5% ed è uscito in perdita | Stop mobile più stretto (`risk.trailAtr`) |
| uscita tardiva | In guadagno, ma ha restituito più di metà del movimento | Stop mobile più stretto |
| non partito | Chiuso dallo stop temporale | Filtri più severi o più pazienza (`risk.timeStopCandles`) |
| buona cattura | Ha incassato la maggior parte del movimento | – |

**Riquadro "Correggere il tiro".** Il simulatore segue anche le scelte che *non* ha fatto:
- i titoli scartati per **un solo filtro**, oppure perché non c'era posto o il mercato era in ribasso;
- il prezzo **dopo ogni vendita**.

Dopo 12 candele (2 giorni) misura com'è andata e lo confronta con i titoli effettivamente comprati nello stesso intervallo.
Se gli scartati da un filtro salgono più dei comprati, quel filtro ti sta togliendo occasioni. Se scendono, ti sta proteggendo.
Se dopo le vendite il prezzo continua a salire, stai uscendo troppo presto.
Gli spunti compaiono solo con almeno 10 casi (`review.minSample`) e vanno trattati come **ipotesi**, non come prove.

**Metodo consigliato:**
1. Leggi gli spunti del test sul passato e della simulazione dal vivo.
2. Cambia **un solo** parametro alla volta in `config.json`.
3. Rilancia "Test sul passato" e confronta risultato netto, perdita massima e probabilità del traguardo.
4. Tieni la modifica solo se migliora senza peggiorare molto la perdita massima. Poi controlla che regga anche dal vivo nelle settimane successive.

Attenzione all'**eccesso di ritocchi**: con 120 giorni di storia è facile trovare parametri che "avrebbero funzionato" per caso e poi falliscono.

---

## 6. Limiti da conoscere

- **Test ottimista:** i titoli del test sono scelti tra i più scambiati di *oggi*, quindi l'elenco ignora quelli crollati nel frattempo. Conta di più la simulazione dal vivo.
- **Periodo breve:** 120 giorni coprono una sola fase di mercato. Il test viene ripetuto ogni lunedì: confronta i risultati nel tempo.
- **Ritardi di GitHub:** le esecuzioni programmate possono partire con qualche minuto (a volte decine di minuti) di ritardo. In un repository pubblico senza attività per 60 giorni GitHub può sospenderle: se succede, riattivale dalla scheda *Actions*.
- **Stop "dentro" la candela:** la simulazione considera lo stop scattato appena il minimo della candela lo tocca, come farebbe un ordine stop-loss reale. Nelle discese violente il prezzo reale di esecuzione può essere peggiore.
- **Tasse:** la simulazione non le calcola. Sul conto reale le plusvalenze da cripto sono tassate (33% dal 2026) e ogni operazione va documentata.

---

## 7. Personalizzare

Tutti i parametri sono in `config.json`. Dopo una modifica rilancia **Test sul passato**. La simulazione dal vivo prosegue e registra il cambio di regole nel diario. Se preferisci ripartire da zero, cancella `docs/data/state.json`.

| Parametro | Significato |
|---|---|
| `startCapital`, `failThreshold` | Capitale di partenza e soglia di fallimento |
| `targetMultiple`, `payoutPct` | Moltiplicatore del traguardo e compenso (in % del traguardo) |
| `universe.minVolume24h`, `universe.maxPairs` | Liquidità minima e numero di titoli scansionati |
| `regime.enabled` | `false` per comprare anche con Bitcoin in ribasso (più aggressivo) |
| `entry.*` | Sensibilità del segnale (es. `volumeRatioMin` più basso = più operazioni) |
| `risk.maxPositions` | 1 = tutto su un titolo; 2-3 = più diversificato |
| `risk.trailAtr`, `risk.timeStopCandles` | Quanto lasciar correre i guadagni e quanta pazienza avere |
| `execution.*` | Commissioni, slippage e scostamento massimo dal prezzo del segnale |
| `review.horizonCandles`, `review.minSample` | Dopo quante candele valutare scartati e uscite (12 = 2 giorni) e quanti casi servono per uno spunto |

**Prova locale senza internet** (dati finti, solo per verificare che funzioni): `MOCK=1 node engine/backtest.mjs && MOCK=1 node engine/run.mjs`. Poi cancella i file in `docs/data/` prima di caricare.
