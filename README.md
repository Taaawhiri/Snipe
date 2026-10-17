# HoloSnipe

Web app (PWA) che controlla gli annunci Pokémon su [CardTrader](https://www.cardtrader.com) e ti avvisa quando ne compare uno con un prezzo molto sotto il resto del mercato. L'acquisto lo fai tu: l'alert contiene il link alla pagina della carta.

Gira tutta su Cloudflare, in un solo Worker:

- `public/` e `ui/`: la PWA (le parti in `ui/` si ricompongono in `public/app.js`).
- `src/worker.js`: API, accesso con il token CardTrader di ogni utente, pagamenti.
- `src/scanner.js`: Durable Object, uno per utente, che controlla CardTrader, manda le notifiche e tiene collezione e storico. Quello del proprietario (`main`) è anche il catalogo condiviso (indice dei nomi, Cardmarket, affari del giorno, regioni delle espansioni).
- `src/registry.js`: utenti, piani, sessioni.
- Logica pura con test in `test/`: `deals.js`, `collection.js`, `cardid.js`, `importcsv.js`, `region.js`, `vintage.js`, `billing.js`…

## Come si usa

Le schede in basso:

- **Collezione**: le tue carte con valore, guadagno o perdita e andamento; in alto la scheda **Avvisi** con gli alert scattati (il pallino giallo conta quelli da vedere).
- **Cerca**: scegli un'espansione dall'elenco (filtri per regione International, Giappone, Cina, Corea, Asia e 🕰️ Vintage) oppure "Tutte le espansioni" per cercare un Pokémon per nome. Tocca una carta per vedere gli annunci, creare un alert, aggiungerla ai desideri o alla collezione ("Ce l'ho"). C'è anche lo scanner da foto.
- **Affari**: gli annunci di oggi almeno il 25% sotto il prezzo tipico, con ricerca per nome.
- **Regole**: i tuoi alert (con ricerca per nome), **Verifica** per vedere perché un annuncio fa o non fa scattare l'alert, venditori salvati o esclusi, lista dei desideri.
- **Opzioni**: piano, stato (con il tempo del giro completo degli alert), notifiche, orari silenziosi, backup e dati, account.

Altre cose utili:

- **Cardmarket**: il listino pubblico giornaliero (tendenza, media 30 giorni, minimo) abbinato alle carte tramite l'identificativo Cardmarket indicato da CardTrader. Mescola lingue e condizioni, quindi è solo indicativo: si vede nella scheda della carta e negli avvisi, non nel valore della collezione.
- **CardTrader Zero**: ogni alert può considerare tutti i venditori, solo Zero o escluderli (campo `can_sell_via_hub`).
- **Prima apertura**: chi entra senza alert vede un benvenuto in tre passi (primo alert, notifiche, collezione).

## Il giro degli alert

Ogni controllo (ogni 10 s per Sniper e proprietario, 30 s per Pro, 5 min per Gratuito) legge 2 carte da CardTrader, scegliendo quelle lette da più tempo:

- gli alert su una carta leggono solo quella carta; l'espansione intera si legge solo per gli alert su un set;
- gli alert hanno la precedenza (la stella ★ conta tre volte): desideri e collezione prendono una lettura solo quando le carte degli alert sono state lette negli ultimi 3 minuti;
- quando crei o modifichi un alert, la sua carta si legge subito;
- gli annunci più economici delle carte con un alert si salvano anche su disco, così dopo un aggiornamento dell'app lo scan riparte con i prezzi già letti.

Con 50 alert il giro completo dura circa 4–5 minuti al ritmo di 10 s. In Opzioni → Stato la riga "Giro completo" mostra il tempo reale.

## Regioni delle espansioni e vintage

- **Regione** (International, Giappone, Cina, Corea, Asia): si riconosce dalle lingue degli annunci. Un giro lento nel catalogo condiviso ne fa una al minuto finché non le ha tutte (avanzamento in Opzioni → Stato); quando qualcuno apre un'espansione, la sua regione si salva subito.
- **Data di uscita**: l'API non la fornisce; `src/expdates.js` contiene le date delle 858 espansioni Pokémon prese dalla pagina pubblica di CardTrader. L'elenco delle espansioni è ordinato dalla più recente; quelle uscite dopo (senza data) compaiono in cima.
- **Vintage** (`src/vintage.js`): deciso dalla data di uscita. Era WOTC fino a metà 2003 (comprese le prime giapponesi dal 1996, 74 espansioni) ed era EX fino a febbraio 2007 (95 espansioni), escluse le prime giapponesi Diamante & Perla.

## Importare la collezione (CSV)

Opzioni → Backup e dati → **Importa la collezione**. La prima riga deve avere i nomi delle colonne; separatore `;` o `,`, decimali con virgola o punto.

| Colonna | Obbligatoria | Esempio |
|---|---|---|
| Carta | sì | Umbreon ex |
| Numero | consigliata | 044/040 |
| Espansione | consigliata | 30th Celebration Premium Deck Set (o il codice) |
| Lingua | no | JP |
| Condizione | no (Near Mint) | NM |
| Copie | no (1) | 2 |
| Pagata | no | 100,00 |

Va bene anche il CSV esportato da HoloSnipe (contiene l'ID CardTrader). Prima di importare si vede un riepilogo: **trovate**, **da scegliere** (più carte possibili: si tocca quella giusta, con l'immagine) e **non trovate**. Nome scritto male con il numero completo: la carta finisce tra quelle da scegliere. Le carte già presenti sommano le copie.

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

## Scanner delle carte

Il pulsante "Scansiona" fotografa una carta: il Worker la manda al riconoscimento, che restituisce nome (in inglese), numero, codice del set e lingua; poi `src/cardid.js` cerca le carte corrispondenti nell'indice. Il motore si sceglie con la variabile `SCAN_PROVIDER` del Worker:

- `workers-ai` (predefinito): Cloudflare Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct`), nessuna chiave esterna.
- `claude`: Claude Haiku 5.5, con Claude Opus 5.5 di riserva quando Haiku non è sicuro. Serve il Secret `ANTHROPIC_API_KEY`; `SCAN_CLAUDE_MODEL` cambia il modello principale, `SCAN_CLAUDE_FALLBACK=off` toglie la riserva.

Scansioni al mese per piano: Gratuito 5, Pro 200, Sniper 1000.

## Lingue

L'interfaccia è in italiano; `public/i18n.js` la traduce in inglese al volo (scelta in Opzioni o sulla pagina di accesso, predefinita in base alla lingua del browser). Per una frase nuova basta aggiungerla al dizionario in quel file. Notifiche push e pagine legali restano in italiano.

## Account e piani

- L'accesso è un cookie di sessione firmato. Il token CardTrader resta nel server dati dell'utente e non torna mai al telefono.
- `src/registry.js` tiene l'elenco degli utenti, il loro piano e la chiave che firma le sessioni.
- `src/plans.js` definisce i piani e cosa include ciascuno:

  | | Gratuito | Pro (4,99 €/mese, 39 €/anno) | Sniper (9,99 €/mese, 79 €/anno) |
  | --- | --- | --- | --- |
  | Alert su una carta | 3 | 30 | 100 |
  | Alert su un set | — | 1 | 10 |
  | Lista dei desideri | 10 | 200 | illimitata |
  | Velocità degli alert | 5 min | 30 s | 10 s |
  | Storico prezzi | 7 giorni | 120 giorni | 120 giorni |
  | Spedizione nell'avviso, stella priorità | — | ✓ | ✓ |

  I nuovi account partono Gratuito. Gli account creati prima dei piani sono passati a Pro gratis. Il piano si cambia dalla sezione Utenti in Impostazioni (solo il proprietario); il pagamento online non è ancora collegato.

Da qui ogni push su `main` va in produzione da solo.

### Notifiche su iPhone

Servono iOS 16.4 o successivo e l'app installata: Safari → Condividi → Aggiungi a Home, poi apri l'icona dalla Home e attiva le notifiche da Impostazioni.

## Struttura della pagina

`public/app.js` è generato: il codice della pagina sta in `ui/`, una parte per sezione (rete, collezione, scanner, carte, notifiche…), e `npm run build` (o `npm run app`) le ricompone in ordine di nome. Un test controlla che `public/app.js` sia allineato con `ui/`.

## Sviluppo in locale

```bash
npm install
cp .dev.vars.example .dev.vars   # poi compila i valori
npm run dev                      # http://localhost:8787
npm test            # logica (server e calcoli)
npm run test:ui     # schermate: la pagina vera con API simulate, in Chromium headless
```

`npm run test:ui` usa `playwright-core`; se il browser non è installato da Playwright, indica un Chromium con `CHROME_PATH=/percorso/chrome`.

## Da verificare

- Il formato del link alla carta (`https://www.cardtrader.com/cards/<blueprint_id>`) è dedotto, non documentato: se non si apre correttamente, va corretto in `src/scanner.js`.
- Nei prodotti Pokémon i nomi dei campi di lingua e condizione in `properties_hash` potrebbero differire da Magic. Il filtro lingua usa il parametro `language` dell'API, quindi non dipende da quei nomi.
- Limiti API: 200 richieste ogni 10 secondi in totale e 10 al secondo sul marketplace. Le letture del marketplace passano da un secchiello di gettoni (6, ricarica adattiva tra 2 e 15 s, ne restano sempre 3 per le richieste aperte dall'utente) che rallenta da solo dopo un 429.

## Stato

`/api/health` mostra la versione in esecuzione.


## Attivare i pagamenti (quando vuoi)

Per ora l'app mostra "pagamento in arrivo": i pulsanti per abbonarsi compaiono da soli **solo quando imposti i link di acquisto**, quindi non serve toccare il codice.

**Passo 1 – Lemon Squeezy.** Crea due prodotti, *Pro* e *Sniper*, ciascuno con una variante mensile e una annuale. Per ogni variante copia il link di acquisto (pulsante *Share*) e il suo ID.

**Passo 2 – Cloudflare.** Apri il Worker → *Settings → Variables* e aggiungi:

| Nome | Cosa metterci |
|---|---|
| `LS_CHECKOUT_PRO_MONTHLY` / `LS_CHECKOUT_PRO_YEARLY` | link di acquisto di Pro |
| `LS_CHECKOUT_SNIPER_MONTHLY` / `LS_CHECKOUT_SNIPER_YEARLY` | link di acquisto di Sniper |
| `LS_VARIANTS_PRO` / `LS_VARIANTS_SNIPER` | ID delle varianti (più ID separati da virgola) |
| `LS_WEBHOOK_SECRET` (tipo **Secret**) | la chiave di firma del passo 3 |

**Passo 3 – Webhook.** Su Lemon Squeezy → *Settings → Webhooks*: URL `https://<tuo-worker>/api/billing/webhook`, spunta tutti gli eventi `subscription_…`, scegli una chiave di firma e mettila in `LS_WEBHOOK_SECRET`.

**Passo 4 – Prova.** Con la modalità test di Lemon Squeezy fai un acquisto con la carta di prova: il piano cambia da solo in pochi secondi. Se un abbonamento viene disdetto resta attivo fino alla scadenza, poi torna Gratuito.

Quando sei pronto, cambia anche le frasi "arriverà a breve" in `public/index.html`.
