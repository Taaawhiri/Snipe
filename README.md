# Snipe

Web app (PWA) che controlla gli annunci Pokémon su [CardTrader](https://www.cardtrader.com) e ti avvisa quando ne compare uno con un prezzo molto sotto il resto del mercato. L'acquisto lo fai tu: l'alert contiene il link alla pagina della carta.

Gira tutta su Cloudflare, in un solo Worker:

- `public/`: la PWA (feed alert, regole, impostazioni).
- `src/worker.js`: serve le API e controlla la chiave `APP_KEY`.
- `src/scanner.js`: Durable Object che ogni 10 secondi interroga CardTrader, confronta i prezzi e manda le notifiche push.
- `src/deals.js`: la logica che decide se un annuncio è anomalo (con test in `test/`).

## Come si usa

- **Carte**: scegli un'espansione e vedi tutte le carte con immagine e prezzo più basso, in assoluto e con CardTrader Zero. Tocca una carta per vedere gli annunci più economici e creare l'alert: sotto un prezzo che scegli tu, oppure con uno sconto in percentuale.
- **Ricerca su tutte le espansioni**: nella scheda Carte scegli "Tutte le espansioni" e scrivi il nome di un Pokémon. La prima volta il server prepara in background un indice dei nomi (una richiesta per espansione, circa 10 minuti, poi si rinnova ogni due settimane). I nomi compaiono subito, i prezzi si caricano a gruppi di 8 espansioni, dalle più recenti, per restare nei limiti di CardTrader.
- **Cardmarket**: Cardmarket non ha un'API aperta, ma pubblica ogni giorno un listino prezzi scaricabile (tendenza, media a 30 giorni, minimo). Il server lo scarica da solo una volta al giorno e lo abbina alle carte tramite l'identificativo Cardmarket che CardTrader indica per ogni carta. Sulle tessere compare la tendenza e di quanto il prezzo CardTrader è sotto; si può ordinare per "Più sotto Cardmarket" e creare alert "almeno X% sotto Cardmarket".
- **Impostazioni**: stato del sistema, pausa generale, frequenza di scansione, orari silenziosi, backup degli alert.
- **Regole**: l'elenco dei tuoi alert, che puoi mettere in pausa o eliminare. Gli alert si creano dalla scheda Carte.
- **CardTrader Zero**: ogni regola può considerare tutti i venditori, solo quelli Zero o escluderli. Si basa sul campo `can_sell_via_hub` dell'API.

## Come decide che un prezzo è sbagliato

Per ogni carta prende gli annunci in vendita (esclusi graded e venditori in vacanza) e guarda i 3 più economici. Ognuno viene confrontato con la **mediana dei 5 annunci successivi**. Se costa almeno il tuo sconto minimo in meno, almeno il prezzo minimo impostato e ci sono almeno 3 annunci di riferimento, scatta l'alert.

Gli alert su una carta valutano subito anche gli annunci già in vendita, poi avvisano una sola volta per ogni annuncio (e di nuovo se il suo prezzo cambia). Se modifichi i criteri di un alert, gli annunci vengono rivalutati.

## Messa online su Cloudflare

1. **Token CardTrader**: dalle impostazioni del tuo profilo CardTrader, sezione API.
2. **Collega la repo**: Cloudflare → Workers & Pages → Create → Import a repository → scegli questa repo.
   - Production branch: `main`
   - Build command: vuoto
   - Deploy command: `npx wrangler deploy`
3. **Secret** (facoltativo, Workers → snipe → Settings → Variables and Secrets, tipo Secret): `CARDTRADER_TOKEN` con il token del proprietario. Chi accede con quello stesso token ritrova i dati del vecchio account unico e ha il piano "Proprietario".
4. Apri l'URL `*.workers.dev` e accedi con il tuo token API di CardTrader. Ogni utente accede con il proprio token: ha alert, lista dei desideri, storico e notifiche separati, e consuma il limite di richieste del suo token.

## Account e piani

- L'accesso è un cookie di sessione firmato. Il token CardTrader resta nel server dati dell'utente e non torna mai al telefono.
- `src/registry.js` tiene l'elenco degli utenti, il loro piano e la chiave che firma le sessioni.
- `src/plans.js` definisce i piani (`free`, `pro`, `owner`) e cosa include ciascuno. Per ora il piano gratuito include tutto: per mettere a pagamento una funzione basta toglierla da `free`.

Da qui ogni push su `main` va in produzione da solo.

### Notifiche su iPhone

Servono iOS 16.4 o successivo e l'app installata: Safari → Condividi → Aggiungi a Home, poi apri l'icona dalla Home e attiva le notifiche da Impostazioni.

## Sviluppo in locale

```bash
npm install
cp .dev.vars.example .dev.vars   # poi compila i valori
npm run dev                      # http://localhost:8787
npm test
```

## Da verificare

- Il formato del link alla carta (`https://www.cardtrader.com/cards/<blueprint_id>`) è dedotto, non documentato: se non si apre correttamente, va corretto in `src/scanner.js`.
- Nei prodotti Pokémon i nomi dei campi di lingua e condizione in `properties_hash` potrebbero differire da Magic. Il filtro lingua usa il parametro `language` dell'API, quindi non dipende da quei nomi.
- Limiti API: 200 richieste ogni 10 secondi in totale e 10 al secondo sul marketplace. Lo scan usa circa 4 richieste al secondo al massimo e riusa la stessa risposta per le regole sulla stessa espansione.

## Stato

`/api/health` mostra la versione in esecuzione.

