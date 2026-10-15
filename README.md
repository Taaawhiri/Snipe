# Snipe

Web app (PWA) che controlla gli annunci Pokémon su [CardTrader](https://www.cardtrader.com) e ti avvisa quando ne compare uno con un prezzo molto sotto il resto del mercato. L'acquisto lo fai tu: l'alert contiene il link alla pagina della carta.

Gira tutta su Cloudflare, in un solo Worker:

- `public/`: la PWA (feed alert, regole, impostazioni).
- `src/worker.js`: serve le API e controlla la chiave `APP_KEY`.
- `src/scanner.js`: Durable Object che ogni 10 secondi interroga CardTrader, confronta i prezzi e manda le notifiche push.
- `src/deals.js`: la logica che decide se un annuncio è anomalo (con test in `test/`).

## Come si usa

- **Carte**: scegli un'espansione e vedi tutte le carte con immagine e prezzo più basso, in assoluto e con CardTrader Zero. Tocca una carta per vedere gli annunci più economici e creare l'alert: sotto un prezzo che scegli tu, oppure con uno sconto in percentuale.
- **Regole**: l'elenco dei tuoi alert, che puoi mettere in pausa o eliminare. Gli alert si creano dalla scheda Carte.
- **CardTrader Zero**: ogni regola può considerare tutti i venditori, solo quelli Zero o escluderli. Si basa sul campo `can_sell_via_hub` dell'API.

## Come decide che un prezzo è sbagliato

Per ogni carta prende gli annunci in vendita (esclusi graded e venditori in vacanza) e guarda i 3 più economici. Ognuno viene confrontato con la **mediana dei 5 annunci successivi**. Se costa almeno il tuo sconto minimo in meno, almeno il prezzo minimo impostato e ci sono almeno 3 annunci di riferimento, scatta l'alert.

Un alert "sotto un prezzo" su una carta scatta subito anche per gli annunci già in vendita sotto la soglia. Gli alert in percentuale alla prima scansione memorizzano soltanto ciò che c'è già e avvisano per i nuovi annunci o per i cali di prezzo.

## Messa online su Cloudflare

1. **Token CardTrader**: dalle impostazioni del tuo profilo CardTrader, sezione API.
2. **Collega la repo**: Cloudflare → Workers & Pages → Create → Import a repository → scegli questa repo.
   - Production branch: `main`
   - Build command: vuoto
   - Deploy command: `npx wrangler deploy`
3. **Secret** (Workers → snipe → Settings → Variables and Secrets → Add, tipo Secret):

   | Nome | Valore |
   | --- | --- |
   | `CARDTRADER_TOKEN` | il token del punto 1 |
   | `APP_KEY` | una password a tua scelta, la digiti all'apertura dell'app |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | output di `npm run vapid` |

4. In `wrangler.jsonc` sostituisci `VAPID_SUBJECT` con `mailto:la-tua@email`, poi fai push.
5. Apri l'URL `*.workers.dev`, inserisci `APP_KEY`, crea una regola e attiva le notifiche dalla scheda Impostazioni.

Da qui ogni push su `main` va in produzione da solo.

### Notifiche su iPhone

Servono iOS 16.4 o successivo e l'app installata: Safari → Condividi → Aggiungi a Home, poi apri l'icona dalla Home.

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

Se l'app mostra "APP_KEY non configurata", apri `/api/health`: elenca quali Secret il Worker riesce a leggere.

