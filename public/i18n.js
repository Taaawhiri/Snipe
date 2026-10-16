// Inglese: l'interfaccia è scritta in italiano e qui la traduciamo al volo.
// Un osservatore traduce ogni testo che compare nella pagina (testi, segnaposto, etichette, titoli)
// con un dizionario di frasi intere e alcune regole per le frasi con numeri e nomi.
(() => {
  const KEY = 'snipe.lang';
  let lang = 'it';
  try { lang = localStorage.getItem(KEY) || ''; } catch {}
  if (lang !== 'it' && lang !== 'en') lang = /^it\b/i.test(navigator.language || '') ? 'it' : 'en';

  window.snipeLang = {
    get: () => lang,
    set: (l) => {
      try { localStorage.setItem(KEY, l); } catch {}
      location.reload();
    },
  };
  document.documentElement.lang = lang;
  if (lang !== 'en') return;

  const D = {
    // pagina di accesso
    'Gli affari sulle carte Pokémon di CardTrader, appena compaiono.': 'Pokémon card deals on CardTrader, the moment they appear.',
    'Entra con CardTrader': 'Sign in with CardTrader',
    'Accedi a': 'Log in to',
    'e apri il tuo profilo →': 'and open your profile →',
    'Impostazioni': 'Settings',
    'Copia il tuo': 'Copy your',
    'token API': 'API token',
    '(una lunga stringa di lettere e numeri).': '(a long string of letters and numbers).',
    'Incollalo qui sotto: il tuo account Snipe è legato al tuo utente CardTrader.': 'Paste it below: your Snipe account is linked to your CardTrader user.',
    'Token API CardTrader': 'CardTrader API token',
    'Incolla il token': 'Paste the token',
    'Entra': 'Sign in',
    'Il token resta sul server di Snipe e non viene mai mostrato né condiviso. Puoi revocarlo in qualsiasi momento da CardTrader.': 'The token stays on the Snipe server and is never shown or shared. You can revoke it at any time from CardTrader.',
    'Entrando accetti i': 'By signing in you accept the',
    'termini di servizio': 'terms of service',
    "e l'": 'and the ',
    'informativa sulla privacy': 'privacy policy',
    '🔔 Alert immediati': '🔔 Instant alerts',
    'Scegli una carta e un prezzo: quando un annuncio scende sotto, ti arriva una notifica sul telefono.': 'Pick a card and a price: when a listing drops below it, you get a notification on your phone.',
    '📉 Sconti anomali': '📉 Unusual discounts',
    'Riconosce gli annunci molto sotto il resto del mercato, anche su un intero set.': 'Spots listings far below the rest of the market, even across a whole set.',
    '🃏 Tutte le carte': '🃏 Every card',
    'Prezzi più bassi con e senza CardTrader Zero, filtri per lingua e condizione, confronto con Cardmarket.': 'Lowest prices with and without CardTrader Zero, language and condition filters, Cardmarket comparison.',
    '📦 Costo reale': '📦 Real cost',
    'Spedizione stimata del venditore e totale, storico dei prezzi e lista dei desideri.': "Seller's estimated shipping and total, price history and wishlist.",
    '🔒 Nessun acquisto automatico': '🔒 No automatic purchases',
    'Snipe legge soltanto il marketplace: compri tu, con un tocco, su CardTrader.': 'Snipe only reads the marketplace: you buy, with one tap, on CardTrader.',
    'Piani': 'Plans',
    'Si parte gratis. Il pagamento online dei piani Pro e Sniper arriverà a breve.': 'Start for free. Online payment for Pro and Sniper is coming soon.',
    'Connessione non riuscita: riprova.': 'Connection failed: try again.',
    'Accesso richiesto': 'Sign-in required',
    'Incolla il token API di CardTrader.': 'Paste your CardTrader API token.',
    'CardTrader non accetta questo token: controlla di averlo copiato tutto.': "CardTrader doesn't accept this token: make sure you copied all of it.",
    'Risposta inattesa da CardTrader.': 'Unexpected response from CardTrader.',
    'Questo account è stato sospeso.': 'This account has been suspended.',

    // schede e intestazione
    'Alert': 'Alerts', 'Carte': 'Cards', 'Affari': 'Deals', 'Regole': 'Rules', 'Opzioni': 'Options', 'Sezioni': 'Sections',
    'In avvio…': 'Starting…', 'Nessuna regola attiva': 'No active rules',

    // avvisi
    'alert attivi': 'active alerts', 'avvisi ricevuti': 'alerts received', 'scansioni': 'scans',
    'Filtra avvisi': 'Filter alerts', 'Da vedere': 'To check', 'Tutti': 'All', 'Comprati': 'Bought',
    'Nessun avviso per ora': 'No alerts yet',
    'Scegli una carta e imposta un prezzo: appena un annuncio scende sotto la soglia lo trovi qui.': 'Pick a card and set a price: as soon as a listing drops below it, you will find it here.',
    'Vai alle carte': 'Go to cards',
    'Segna visto': 'Mark as seen', '✓ Visto': '✓ Seen', 'Comprato': 'Bought', '✓ Comprato': '✓ Bought',
    'Nessun avviso segnato come comprato.': 'No alerts marked as bought.',
    'Hai già visto tutti gli avvisi.': "You've already seen every alert.",
    'Spedizione con CardTrader Zero: una sola per tutto l’ordine': 'Shipping via CardTrader Zero: one shipment for the whole order',
    'Spedizione non stimata': 'Shipping not estimated',
    'Di nuovo disponibile': 'Back in stock', 'Disponibile': 'Available', 'Sotto soglia': 'Below threshold', 'prova': 'test',
    '7 giorni fa': '7 days ago', 'CardTrader ↗': 'CardTrader ↗',

    // carte
    'Espansione': 'Expansion', 'Cerca (es. 151, Obsidian, Paldea)': 'Search (e.g. 151, Obsidian, Paldea)',
    'Alert su tutto il set': 'Alert on the whole set', 'Cerca carta': 'Search card', 'es. Charizard': 'e.g. Charizard',
    'Nome del Pokémon (es. Pikachu)': 'Pokémon name (e.g. Pikachu)',
    'Lingua': 'Language', 'Tutte le lingue': 'All languages', 'Tutte (lingue non indicate)': 'All (language not stated)',
    'Condizione minima': 'Minimum condition', 'Qualsiasi': 'Any',
    'Near Mint o migliore': 'Near Mint or better', 'Slightly Played o migliore': 'Slightly Played or better',
    'Moderately Played o migliore': 'Moderately Played or better', 'Played o migliore': 'Played or better',
    'Ordina per': 'Sort by', 'Prezzo: dal più alto': 'Price: high to low', 'Prezzo: dal più basso': 'Price: low to high',
    'Più sotto Cardmarket': 'Furthest below Cardmarket', 'Numero': 'Number', 'Nome': 'Name',
    'Altri filtri': 'More filters', 'Prezzo mostrato': 'Price shown', 'Il più basso in assoluto': 'Lowest overall',
    'Solo con CardTrader Zero': 'CardTrader Zero only', 'Mostra': 'Show', 'Solo carte singole': 'Single cards only',
    'Tutti i prodotti': 'All products', 'Mostra altre espansioni': 'Show more expansions',
    'Tutte le espansioni (cerca per nome)': 'All expansions (search by name)',
    'Scegli un’espansione…': 'Choose an expansion…', 'Nessun risultato': 'No results',
    'Scegli un’espansione per vedere le carte.': 'Choose an expansion to see its cards.',
    'Carico le carte…': 'Loading cards…', 'Cerco…': 'Searching…', 'Nessuna immagine': 'No image',
    'CardTrader non ha restituito carte per questa espansione.': 'CardTrader returned no cards for this expansion.',
    'CardTrader sta limitando le richieste, prezzi parziali': 'CardTrader is rate-limiting, partial prices',
    'Apri su CardTrader': 'Open on CardTrader',

    // dettaglio carta
    'Carta': 'Card', 'Più basso': 'Lowest', 'Con Zero': 'With Zero', 'Chiudi': 'Close',
    '☆ Aggiungi alla lista dei desideri': '☆ Add to wishlist',
    '★ Nella lista dei desideri (tocca per togliere)': '★ In your wishlist (tap to remove)',
    'Apri su CardTrader ↗': 'Open on CardTrader ↗', 'Annunci più economici': 'Cheapest listings',
    'Carico gli annunci…': 'Loading listings…', 'Nessun annuncio in vendita.': 'No listings for sale.',
    '☆ Salva': '☆ Save', '★ Salvato': '★ Saved', '⛔ Escludi': '⛔ Exclude', '⛔ Escluso': '⛔ Excluded', 'Escluso': 'Excluded',
    'Salva venditore': 'Save seller', 'Togli dai preferiti': 'Remove from saved', 'Escludi venditore': 'Exclude seller', 'Riammetti': 'Allow again',
    'Cardmarket · tutte le lingue e condizioni': 'Cardmarket · all languages and conditions',
    'tendenza': 'trend', 'media 30 giorni': '30-day average', 'più basso': 'lowest',
    'Il listino pubblico di Cardmarket non distingue lingue e condizioni: il "più basso" può essere una copia rovinata o in un’altra lingua, quindi il confronto è solo indicativo.': 'The public Cardmarket price guide mixes languages and conditions: the "lowest" may be a worn copy or another language, so the comparison is only indicative.',
    'Cerca su Cardmarket ↗': 'Search on Cardmarket ↗',
    'Crea alert': 'Create alert', 'Tipo di alert': 'Alert type', 'Sotto un prezzo': 'Below a price', 'Sconto in %': 'Discount %',
    'Sotto Cardmarket': 'Below Cardmarket', 'Calo di prezzo': 'Price drop', 'Torna disponibile': 'Back in stock',
    'Avvisami se costa meno di (€)': 'Alert me if it costs less than (€)',
    'Avvisami se il prezzo più basso scende di almeno': 'Alert me if the lowest price drops by at least',
    'rispetto a 7 giorni fa': 'compared to 7 days ago',
    'Usa lo storico prezzi: parte dopo 3 giorni di dati sulla carta.': 'Uses the price history: starts after 3 days of data on the card.',
    'Ti avviso quando la carta passa da nessun annuncio (con i filtri qui sotto) ad almeno uno, a qualunque prezzo.': 'You get an alert when the card goes from no listings (with the filters below) to at least one, at any price.',
    'Almeno': 'At least', 'sotto la tendenza Cardmarket': 'below the Cardmarket trend', 'sotto il prezzo di 7 giorni fa': 'below the price 7 days ago',
    'Sconto minimo sul prezzo tipico:': 'Minimum discount on the typical price:',
    'Il prezzo tipico è la mediana dei 5 annunci successivi. Servono almeno 3 altri annunci.': 'The typical price is the median of the next 5 listings. At least 3 other listings are needed.',
    'CardTrader Zero': 'CardTrader Zero', 'Tutte': 'All', 'Solo Zero': 'Zero only', 'Senza Zero': 'Without Zero',
    'Inglese': 'English', 'Italiano': 'Italian', 'Giapponese': 'Japanese', 'Francese': 'French', 'Tedesco': 'German', 'Spagnolo': 'Spanish',
    'Portoghese': 'Portuguese', 'Coreano': 'Korean', 'Cinese': 'Chinese', 'Russo': 'Russian', 'Thailandese': 'Thai', 'Lingua non indicata': 'Language not stated',
    'Alert creato. Lo trovi nella scheda Regole.': 'Alert created. You can find it in the Rules tab.',
    'Inserisci un prezzo maggiore di zero.': 'Enter a price greater than zero.',
    'Per questa carta non c’è un riferimento Cardmarket.': 'There is no Cardmarket reference for this card.',
    'Prezzo più basso · da oggi': 'Lowest price · since today',

    // affari del giorno
    'Affari del giorno': 'Deals of the day',
    'Annunci delle espansioni più recenti e più ricercate su Snipe che costano almeno il 25% meno del prezzo tipico della stessa carta su CardTrader, confrontati solo con gli annunci nella stessa lingua. Near Mint o meglio, da 5 € in su. Si aggiorna da solo durante il giorno.': 'Listings from the latest and most searched expansions on Snipe at least 25% cheaper than the typical price of the same card on CardTrader, compared only with listings in the same language. Near Mint or better, from €5. Updates by itself during the day.',
    'Carico gli affari…': 'Loading deals…',
    'Sto raccogliendo i primi dati: le espansioni si controllano una ogni 10 minuti. Riprova più tardi.': 'Collecting the first data: one expansion is checked every 10 minutes. Try again later.',

    // regole, venditori, desideri
    'I tuoi alert': 'Your alerts', 'Per crearne uno apri': 'To create one open',
    ', scegli la carta e imposta prezzo o sconto, oppure scegli un set e tocca': ', pick the card and set a price or discount, or pick a set and tap',
    'Nessun alert': 'No alerts', 'Creane uno dalla scheda Carte per avviare lo scan.': 'Create one from the Cards tab to start scanning.',
    'Verifica': 'Check', 'Modifica': 'Edit', 'Pausa': 'Pause', 'Riattiva': 'Resume', 'Elimina': 'Delete', 'Elimina alert': 'Delete alert',
    'Metti in pausa': 'Pause', 'Controlla più spesso': 'Check more often', 'Dai priorità': 'Give priority', 'Togli priorità': 'Remove priority',
    'In pausa': 'Paused', 'Qualsiasi condizione': 'Any condition', 'Torna disponibile ': 'Back in stock',
    'Fermo: oltre il limite del piano': 'Stopped: over the plan limit',
    'Nella lista dei desideri': 'In your wishlist', 'Aggiungi alla lista dei desideri': 'Add to wishlist', 'Togli dalla lista dei desideri': 'Remove from wishlist',
    'Venditori': 'Sellers',
    'Salva un venditore con ★ o escludilo con ⛔ dagli annunci nel dettaglio di una carta. Gli esclusi non fanno più scattare alert.': "Save a seller with ★ or exclude them with ⛔ from the listings in a card's details. Excluded sellers no longer trigger alerts.",
    'Venditore salvato': 'Saved seller', 'Escluso dagli alert': 'Excluded from alerts', 'I suoi annunci': 'Their listings', 'Togli': 'Remove', 'Apri': 'Open',
    'Nessun venditore salvato o escluso.': 'No saved or excluded sellers.',
    'Venditore': 'Seller', 'Cerco i suoi annunci…': 'Looking for their listings…',
    'CardTrader non permette di leggere tutto il negozio di un venditore: qui trovi i suoi annunci tra le carte e le espansioni che Snipe ha letto di recente (i tuoi alert, le carte e i set che hai aperto).': "CardTrader doesn't allow reading a seller's whole shop: here are their listings among the cards and expansions Snipe has read recently (your alerts, the cards and sets you opened).",
    'Nessun suo annuncio tra le carte lette di recente. Apri qualche espansione o carta e riprova.': 'None of their listings among recently read cards. Open some expansions or cards and try again.',
    'Lista dei desideri': 'Wishlist',
    'Carte che segui senza alert: il prezzo si aggiorna ogni 15 minuti circa. Aggiungile dal dettaglio di una carta o con ♥ dai tuoi alert.': "Cards you follow without an alert: the price updates about every 15 minutes. Add them from a card's details or with ♥ from your alerts.",
    'La lista è vuota.': 'The list is empty.', 'Prezzo in arrivo…': 'Price coming…',
    'Modifica alert': 'Edit alert', 'Salva modifiche': 'Save changes', 'Verifica alert': 'Check alert',
    'Nome carta (facoltativo)': 'Card name (optional)', 'Prezzo minimo (€)': 'Minimum price (€)',
    'Avviso quando la carta torna ad avere almeno un annuncio con questi filtri.': 'Alert when the card has at least one listing with these filters again.',
    'Alert su tutta l’espansione': 'Alert on the whole expansion',
    'Scatta per qualunque carta del set che rispetta i filtri.': 'Triggers for any card in the set that matches the filters.',
    'Controllo gli annunci attuali…': 'Checking current listings…', 'Nessuno rispetta i filtri.': 'None match the filters.', 'Valido': 'Valid',

    // opzioni
    'Il tuo piano': 'Your plan', 'Confronta i piani': 'Compare plans',
    'Il pagamento online arriverà a breve. Gli account creati prima dei piani restano Pro gratis fino ad allora.': 'Online payment is coming soon. Accounts created before the plans stay on Pro for free until then.',
    'Gratuito': 'Free', 'Proprietario': 'Owner', 'Prezzo': 'Price', '0 €': '€0', '4,99 €/mese': '€4.99/month', '9,99 €/mese': '€9.99/month',
    'Alert su una carta': 'Card alerts', 'Alert su tutto un set': 'Whole-set alerts', 'Alert su un set': 'Set alerts',
    'Velocità degli alert': 'Alert speed', 'Storico prezzi': 'Price history', 'Spedizione nell’avviso': 'Shipping in alerts', 'Stella priorità': 'Priority star',
    'illimitati': 'unlimited', 'illimitata': 'unlimited', 'non inclusi': 'not included', 'Alert fermi': 'Stopped alerts',
    'Stato': 'Status', 'Attivo': 'Active', 'Attenzione': 'Warning', 'Account': 'Account', 'Scansione': 'Scanning', 'Alert attivi': 'Active alerts',
    'tutto regolare': 'all good', 'Indice delle carte': 'Card index', 'non ancora creato': 'not created yet', 'Prezzi Cardmarket': 'Cardmarket prices',
    'in scaricamento…': 'downloading…', 'Iscrizioni alle notifiche': 'Notification subscriptions', 'Versione': 'Version',
    'Ritmo richieste CardTrader': 'CardTrader request pace', 'Ultimi 429': 'Latest 429s', 'nessuno': 'none', 'Errore indice': 'Index error',
    'nessun alert attivo': 'no active alerts', 'in avvio…': 'starting…',
    "Rinnova l'indice delle carte": 'Rebuild the card index',
    'Indice in rinnovo: ci vorranno circa 10 minuti. La ricerca continua a funzionare nel frattempo.': 'Index rebuilding: it will take about 10 minutes. Search keeps working meanwhile.',
    'Metti in pausa tutti gli alert': 'Pause all alerts', 'Controlla CardTrader ogni': 'Check CardTrader every',
    '10 secondi': '10 seconds', '20 secondi': '20 seconds', '30 secondi': '30 seconds', '60 secondi': '60 seconds', '5 minuti': '5 minutes',
    "Più è lungo l'intervallo, meno richieste fai a CardTrader. Con tanti alert conviene 20 o 30 secondi.": 'The longer the interval, the fewer requests to CardTrader. With many alerts, 20 or 30 seconds is better.',
    'Notifiche': 'Notifications', 'Solo iPhone: tocca Condividi, poi': 'iPhone only: tap Share, then', 'Aggiungi a Home': 'Add to Home Screen',
    ", e apri Snipe dall'icona (serve iOS 16.4 o successivo).": ', and open Snipe from the icon (iOS 16.4 or later needed).',
    'Premi': 'Press', 'Attiva notifiche': 'Enable notifications', 'e consenti l\'avviso quando il browser lo chiede.': 'and allow it when the browser asks.',
    'Invia notifica di prova': 'Send test notification', 'per controllare che arrivi.': 'to check that it arrives.',
    'Tieni solo questo dispositivo': 'Keep only this device', 'Notifiche attive': 'Notifications on',
    'Orari silenziosi': 'Quiet hours', 'Dalle': 'From', 'Alle': 'To',
    "Negli orari silenziosi non ricevi notifiche, ma gli avvisi compaiono comunque nell'elenco.": 'During quiet hours you get no notifications, but alerts still appear in the list.',
    "Suono e vibrazione con l'app aperta": 'Sound and vibration with the app open',
    'Riepilogo ogni mattina alle 9': 'Summary every morning at 9',
    "Avvisi delle ultime 24 ore e carte della lista dei desideri scese di prezzo. Arriva solo se c'è qualcosa da dire.": 'Alerts from the last 24 hours and wishlist cards that dropped in price. Only sent when there is something to report.',
    'Backup degli alert': 'Alert backup',
    "Salva i tuoi alert in un file, per ritrovarli se cambi telefono o ricrei il progetto. L'importazione aggiunge gli alert senza cancellare quelli che hai.": 'Save your alerts to a file, to restore them if you change phone. Importing adds alerts without deleting the ones you have.',
    'Esporta in un file': 'Export to a file', 'Importa da un file': 'Import from a file',
    'Utenti': 'Users', 'Aggiorna': 'Refresh', 'Dati': 'Data', 'Cancella lo storico avvisi': 'Clear alert history', 'Esci': 'Sign out',
    'Termini di servizio': 'Terms of service', 'Privacy': 'Privacy', 'Lingua dell’app': 'App language',
    'Sospendi account': 'Suspend account', 'Riattiva account': 'Reactivate account', 'Sospeso': 'Suspended',
    'nessuno scan': 'no scans', 'mai scansionato': 'never scanned', 'nuovi in 7 giorni': 'new in 7 days', 'attivi in 7 giorni': 'active in 7 days',
    'Iscritti al giorno negli ultimi 30 giorni': 'Sign-ups per day over the last 30 days', 'iscritti al giorno · 30 giorni fa': 'sign-ups per day · 30 days ago', 'oggi': 'today',
    'Questo dispositivo riceve una notifica quando un annuncio rispetta uno dei tuoi alert.': 'This device gets a notification when a listing matches one of your alerts.',
    'Attivale per ricevere un avviso anche con l’app chiusa.': 'Turn them on to get alerts even with the app closed.',
    'Le notifiche sono bloccate per questo sito: riabilitale dalle impostazioni del browser.': 'Notifications are blocked for this site: re-enable them in your browser settings.',
    'Attiva prima le notifiche su questo dispositivo.': 'Enable notifications on this device first.',
    'Ora le notifiche arrivano solo a questo dispositivo.': 'Notifications now go to this device only.',
    'Notifica di prova inviata: dovrebbe arrivare entro pochi secondi.': 'Test notification sent: it should arrive within a few seconds.',
    'Non è stato possibile inviarla: riattiva le notifiche su questo dispositivo.': 'Could not send it: re-enable notifications on this device.',
    'Su iPhone le notifiche funzionano solo dall’app installata: aggiungila alla Home e aprila da lì.': 'On iPhone notifications only work from the installed app: add it to your Home Screen and open it from there.',
    'Solo il proprietario può gestire gli utenti.': 'Only the owner can manage users.',
    'Solo il proprietario può rinnovare l’indice.': 'Only the owner can rebuild the index.',
    'Gli alert su tutto un set sono inclusi nei piani Pro e Sniper.': 'Whole-set alerts are included in the Pro and Sniper plans.',
    'Regola non valida': 'Invalid rule',
    'Nessuna regola attiva ': 'No active rules',
    'Le notifiche funzionano.': 'Notifications work.',
    // collezione
    'Collezione': 'Collection', 'Avvisi': 'Alerts', 'Vista': 'View', 'Valore': 'Value', 'Guadagno': 'Gain', 'Per set': 'By set', 'Variazione': 'Change',
    'Ordina la collezione': 'Sort the collection', 'Valore attuale (prezzo più basso CardTrader)': 'Current value (lowest CardTrader price)',
    'Il grafico del valore compare dal secondo giorno.': 'The value chart appears from the second day.',
    'La collezione è vuota: aggiungi la prima carta.': 'Your collection is empty: add your first card.',
    'spesi': 'spent', 'guadagno teorico': 'theoretical gain', 'CardTrader': 'CardTrader',
    "Aggiungi le carte dal loro dettaglio con": "Add cards from their details with", "Ce l'ho": 'I own it', ', oppure in automatico segnando un avviso come': ', or automatically by marking an alert as',
    '. Il valore usa il prezzo più basso su CardTrader nella lingua e condizione della tua copia, aggiornato ogni ora.': '. The value uses the lowest CardTrader price in the language and condition of your copy, updated hourly.',
    '+ Aggiungi dalla scheda Carte': '+ Add from the Cards tab', 'Copie': 'Copies', "Pagata (€ l'una, facoltativo)": 'Paid (€ each, optional)', 'Condizione': 'Condition',
    'Aggiungi alla collezione': 'Add to collection', 'Una copia in più': 'One more copy', 'Una copia in meno': 'One less copy', '≈ altra lingua': '≈ other language',
    'Nessun annuncio nella tua lingua e condizione: prezzo più basso in assoluto': 'No listings in your language and condition: lowest overall price',
    'Carta mancante': 'Card missing',
    'Bloccate': 'Blocked', 'Attive': 'On', 'Non attive': 'Off', 'Non disponibili': 'Unavailable', 'Disattivate': 'Off', 'Non supportate': 'Not supported', 'Da attivare': 'To enable',
  };

  const R = [
    [/^(\d+)s fa$/, '$1s ago'], [/^(\d+)m fa$/, '$1m ago'], [/^(\d+)h fa$/, '$1h ago'], [/^(\d+)g fa$/, '$1d ago'], [/^adesso$/, 'just now'],
    [/^Ultimo scan (.+) fa$/, 'Last scan $1 ago'], [/^ultimo controllo (.+) fa$/, 'last check $1 ago'], [/^scan (.+) fa$/, 'scan $1 ago'],
    [/^Ultimo scan (.+)$/, 'Last scan $1'], [/^ultimo controllo (.+)$/, 'last check $1'],
    [/^Errore (\d+)$/, 'Error $1'],
    [/^Da (.+)$/, 'From $1'], [/^(.) (.+) in 7 giorni$/, '$1 $2 in 7 days'],
    [/^ultimi (\d+) giorni$/, 'last $1 days'], [/^Prezzo più basso · ultimi (\d+) giorni$/, 'Lowest price · last $1 days'],
    [/^Più basso (.+)$/, 'Lowest $1'], [/^Con Zero (.+)$/, 'With Zero $1'], [/^dal (.+)$/, 'since $1'],
    [/^(\d+) affari · aggiornati (.+) · (\d+) espansioni controllate( \((\d+) tra le più ricercate\))?$/, (m, a, b, c, x, d) => `${a} deals · updated ${b} · ${c} expansions checked${d ? ` (${d} among the most searched)` : ''}`],
    [/^Cardmarket tendenza (.+)$/, 'Cardmarket trend $1'],
    [/^Prezzo tipico CardTrader (.+)$/, 'Typical CardTrader price $1'],
    [/^Cardmarket da (.+) · tutte le lingue e condizioni$/, 'Cardmarket from $1 · all languages and conditions'],
    [/^Escludere (.+)\? I suoi annunci non faranno più scattare alert\.$/, 'Exclude $1? Their listings will no longer trigger alerts.'],
    [/^Eliminare l'alert "(.+)"\? Anche i suoi avvisi verranno cancellati\.$/, 'Delete the alert "$1"? Its alerts will be deleted too.'],
    [/^Sospendere (.+)\? Non potrà più accedere e i suoi alert si fermano\.$/, 'Suspend $1? They will no longer be able to sign in and their alerts stop.'],
    [/^♥ Aggiungi le carte dei tuoi alert \((\d+)\)$/, '♥ Add the cards from your alerts ($1)'],
    [/^(\d+) carte$/, '$1 cards'], [/^(\d+) carta$/, '$1 card'], [/^(\d+) giorni$/, '$1 days'],
    [/^ogni (\d+) min$/, 'every $1 min'], [/^ogni (\d+) s$/, 'every $1 s'], [/^ogni (\d+) minuti$/, 'every $1 minutes'], [/^fino a ogni (\d+) secondi$/, 'as often as every $1 seconds'],
    [/^(\d+) su (\d+)$/, '$1 of $2'], [/^(\d+) \(non inclusi\)$/, '$1 (not included)'], [/^(\d+) oltre il limite del piano$/, '$1 over the plan limit'],
    [/^(.+) · piano (.+)$/, (m, n, p) => `${n} · ${D[p] || p} plan`],
    [/^(\d+) (utente|utenti) · (\d+) con alert attivi · (.+)$/, (m, a, u, b, c) => `${a} ${u === 'utente' ? 'user' : 'users'} · ${b} with active alerts · ${c.replace(/Gratuito|Proprietario/g, (w) => D[w])}`],
    [/^Consumo stimato: ~(.+) richieste al giorno$/, 'Estimated usage: ~$1 requests per day'],
    [/^(\d+)% dei 100\.000 del piano gratuito Cloudflare$/, '$1% of the 100,000 in the Cloudflare free plan'],
    [/^Oggi finora: (.+) giri di scan \(si azzera a mezzanotte UTC, cioè alle (.+) ora italiana\)\.$/, 'Today so far: $1 scan rounds (resets at midnight UTC, i.e. $2 Italian time).'],
    [/^ID CardTrader (\d+) · iscritto (.+) · ultimo accesso (.+)$/, 'CardTrader ID $1 · joined $2 · last sign-in $3'],
    [/^(.+) \/ (.+) alert attivi$/, '$1 / $2 active alerts'], [/^(\d+) avvisi$/, '$1 alerts'], [/^(\d+) desideri$/, '$1 wishlist'],
    [/^(\d+) dispositivi?$/, (m, n) => `${n} ${n === '1' ? 'device' : 'devices'}`], [/^~(.+) richieste\/giorno$/, '~$1 requests/day'],
    [/^Pro o Sniper \((\d+)%\)$/, 'Pro or Sniper ($1%)'], [/^Piano di (.+)$/, 'Plan of $1'], [/^(.+) \(tu\)$/, '$1 (you)'],
    [/^(\d+) (carta comprata|carte comprate) con Snipe · (.+) risparmiati rispetto al riferimento$/, (m, n, w, s) => `${n} ${n === '1' ? 'card' : 'cards'} bought with Snipe · ${s} saved vs the reference`],
    [/^\+ (.+) spedizione( tracciata)? → totale (.+)$/, (m, a, t, b) => `+ ${a}${t ? ' tracked' : ''} shipping → total ${b}`],
    [/^Calo −(\d+)% in 7 giorni$/, 'Drop −$1% in 7 days'], [/^Sotto (.+)$/, 'Below $1'], [/^Sconto da (\d+)%$/, 'Discount from $1%'],
    [/^Espansione (\d+)$/, 'Expansion $1'], [/^Nuovo alert: (.+)$/, 'New alert: $1'],
    [/^(\d+) su (\d+)$/, '$1 of $2'], [/^pronto \((\d+) espansioni\)$/, 'ready ($1 expansions)'], [/^in preparazione (.+)$/, 'building $1'],
    [/^aggiornati (.+)$/, 'updated $1'], [/^non disponibili: (.+)$/, 'unavailable: $1'], [/^richieste limitate fino alle (.+)$/, 'requests limited until $1'],
    [/^una ogni (.+) s · (\d+) pronte$/, 'one every $1 s · $2 ready'],
    [/^(.+) (carta|espansione)$/, (m, t, k) => `${t} ${k === 'carta' ? 'card' : 'expansion'}`],
    [/^Prezzi in (.+)$/, (m, l) => `Prices in ${D[l] || l}`], [/^(.+) o migliore$/, '$1 or better'],
    [/^Su CardTrader costa il (\d+)% in meno della tendenza$/, 'On CardTrader it costs $1% less than the trend'],
    [/^Su CardTrader costa il (\d+)% in più della tendenza$/, 'On CardTrader it costs $1% more than the trend'],
    [/^Il piano (.+) include (\d+) alert su una carta: passa a un piano superiore per aggiungerne altri\.$/, (m, p, n) => `The ${D[p] || p} plan includes ${n} card alerts: upgrade to add more.`],
    [/^Il piano (.+) include (\d+) alert su un set\.$/, (m, p, n) => `The ${D[p] || p} plan includes ${n} set alert(s).`],
    [/^Il piano (.+) include (\d+) carte nella lista dei desideri\.$/, (m, p, n) => `The ${D[p] || p} plan includes ${n} wishlist cards.`],
    [/^Troppi tentativi di accesso: riprova tra (\d+) minuti\.$/, 'Too many sign-in attempts: try again in $1 minutes.'],
    [/^(\d+) alert esportati\.$/, '$1 alerts exported.'], [/^(\d+) alert importati(.*)$/, '$1 alerts imported$2'],
    [/^Ricerca non riuscita: (.+)$/, 'Search failed: $1'], [/^Impossibile caricare le carte: (.+)$/, 'Could not load cards: $1'],
    [/^Elenco espansioni non disponibile: (.+)$/, 'Expansion list unavailable: $1'], [/^Impossibile attivare le notifiche: (.+)$/, 'Could not enable notifications: $1'],
    [/^Impostazione non salvata: (.+)$/, 'Setting not saved: $1'], [/^Esportazione non riuscita: (.+)$/, 'Export failed: $1'], [/^Importazione non riuscita: (.+)$/, 'Import failed: $1'],
    [/^Nessuna carta trovata per “(.+)”\.$/, 'No cards found for “$1”.'],
    [/^(\d+) (carta|carte)(.*)$/, (m, n, w, r) => `${n} ${n === '1' ? 'card' : 'cards'}${r}`],
    [/^(\d+) annunci in vendita, i (\d+) più economici qui sotto\. ?(.*)$/, '$1 listings for sale, the $2 cheapest below. $3'],
    [/^Scatta sotto (.+) \(tendenza (.+), tutte le lingue e condizioni insieme\)\. .*$/, 'Triggers below $1 (trend $2, all languages and conditions together). If you follow a specific language or condition, "Discount %" compares only listings with the same filters.'],
    [/^min (.+) · max (.+)$/, 'min $1 · max $2'],
    [/^Avvisi \((\d+)\)$/, 'Alerts ($1)'], [/^carte \((\d+) diverse\)$/, 'cards ($1 unique)'],
    [/^(.) ([+−-]?[\d,]+)% in (\d+) giorni$/, '$1 $2% in $3 days'],
    [/^Cardmarket \(tendenza (.+)\)$/, 'Cardmarket (trend $1)'],
    [/^(\d+) (copia|copie) ancora senza prezzo: arriva entro un'ora\.$/, (m, n) => `${n} ${n === '1' ? 'copy' : 'copies'} still without a price: it arrives within an hour.`],
    [/^(\d+) su (\d+) carte diverse incluse nel tuo piano\.$/, '$1 of $2 unique cards included in your plan.'],
    [/^(.+) su (.+) carte diverse$/, '$1 of $2 unique cards'], [/^(\d+) carte diverse$/, '$1 unique cards'],
    [/^pagata (.+)$/, 'paid $1'], [/^pagate (.+) l'una$/, 'paid $1 each'], [/^(.+) l'una$/, '$1 each'],
    [/^Ce l'ho · (\d+) (copia|copie)$/, (m, n) => `I own it · ${n} ${n === '1' ? 'copy' : 'copies'}`],
    [/^Togliere (.+) dalla collezione\?$/, 'Remove $1 from the collection?'],
    [/^Il piano (.+) include (\d+) carte diverse nella collezione\.$/, (m, p, n) => `The ${D[p] || p} plan includes ${n} unique cards in the collection.`],
    [/^(\d+)× (.+)$/, (m, n, r) => `${n}× ${r.replace('pagata', 'paid')}`],
    [/^carico i prezzi (.+)$/, 'loading prices $1'],
  ];

  const tr = (s) => {
    const t = s.trim();
    if (!t || !/[A-Za-zÀ-ú]/.test(t)) return null;
    let out = D[t];
    if (out === undefined) {
      for (const [re, rep] of R) {
        if (re.test(t)) { out = t.replace(re, rep); break; }
      }
    }
    if (out === undefined || out === t) return null;
    return s.replace(t, out);
  };

  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const done = new WeakMap();
  function fixText(n) {
    if (done.get(n) === n.nodeValue) return;
    const v = tr(n.nodeValue);
    if (v != null) n.nodeValue = v;
    done.set(n, n.nodeValue);
  }
  function fixEl(e) {
    for (const a of ATTRS) {
      const v = e.getAttribute && e.getAttribute(a);
      if (v) { const t = tr(v); if (t != null) e.setAttribute(a, t); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return fixText(root);
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    fixEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) (n.nodeType === 3 ? fixText(n) : fixEl(n));
  }
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target);
      else if (m.type === 'attributes') fixEl(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  const start = () => {
    walk(document.body);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  const wrap = (fn) => (msg) => fn.call(window, tr(String(msg)) ?? msg);
  window.alert = wrap(window.alert);
  window.confirm = wrap(window.confirm);
  window.snipeT = (s) => tr(s) ?? s;
})();
