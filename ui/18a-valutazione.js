  // ---------- Valutazione del prezzo di un alert ----------
  // Il voto e i numeri li calcola il server dai dati; il parere in parole lo scrive Claude solo se lo chiedi (costa un po').
  async function appraiseRule(r) {
    const d = $('appraisalDialog');
    $('apTitle').textContent = r.cardName || 'Valutazione';
    $('apBody').replaceChildren(el('p', { class: 'muted small', text: 'Valuto il prezzo…' }));
    openSheet(d);
    const pct = (v) => { if (v == null) return '—'; const n = Math.round(v * 100); return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`; };
    // Un parere già dato si riusa per 6 ore; "Rigenera" ne chiede uno nuovo (conta nel limite giornaliero).
    const regen = (kind, label) => {
      const b = el('button', { class: 'btn mini ap-regen', type: 'button', text: `↻ ${label}` });
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Sto rigenerando…';
        try { draw(await api(`/api/appraisal?rule_id=${r.id}&${kind}=1&refresh=1`)); } catch (e) { b.disabled = false; b.textContent = `↻ ${label}`; }
      });
      return b;
    };
    // Dove si colloca il prezzo rispetto agli ultimi giorni, a parole (niente percentili).
    const whereText = (f) => {
      const p = f.pct90 ?? f.pct30;
      const n = Math.min(f.histDays || 0, f.pct90 != null ? 90 : 30);
      if (p <= 0.1) return `È tra i prezzi più bassi degli ultimi ${n} giorni.`;
      if (p >= 0.9) return `È tra i prezzi più alti degli ultimi ${n} giorni.`;
      const x = Math.round(p * n);
      return `Negli ultimi ${n} giorni è stato più basso di così in ${x} ${x === 1 ? 'giorno' : 'giorni'}.`;
    };
    const draw = (a) => {
      const f = a.facts || {};
      const cur = 'EUR';
      const m = (c) => (c == null ? '—' : money(c, cur));
      const rows = [
        ['Più basso ora', m(f.lowCents)], ['Prezzo tipico (mediana dei 5 più bassi)', m(f.typicalCents)],
        ['Annunci acquistabili', f.listings != null ? String(f.listings) : '—'],
        f.min90 != null ? ['Minimo / massimo 90 giorni', `${m(f.min90)} / ${m(f.max90)}`] : null,
        f.change7 != null ? ['Variazione 7 giorni', pct(f.change7)] : null,
        f.change30 != null ? ['Variazione 30 giorni', pct(f.change30)] : null,
        f.cmCents ? ['Tendenza Cardmarket', `${m(f.cmCents)} (${pct(f.vsCm)})`] : null,
        f.limitCents ? ['Soglia dell’alert', `${m(f.limitCents)} (${pct(f.vsLimit)})`] : null,
        ['Giorni di storico', String(f.histDays || 0)],
      ].filter(Boolean);
      const box = [
        el('div', { class: `ap-verdict v-${a.verdict}` }, el('b', { text: a.label }),
          f.listings && (f.pct90 ?? f.pct30) != null ? el('small', { text: whereText(f) }) : f.listings ? el('small', { text: `Sto raccogliendo lo storico di questa ricerca: ${f.histDays || 0} giorni su 5 necessari.` }) : null),
        f.outlierLow && !f.lowIsZero ? el('p', { class: 'small ap-warn', text: 'L’annuncio più basso è molto sotto gli altri: può essere un’offerta isolata. Controlla condizione e lingua.' }) : null,
        f.suggest ? el('div', { class: 'ap-suggest' },
          el('div', { class: 'ap-k', text: f.suggest.now ? 'Puoi comprare adesso' : 'Prezzo consigliato per l’alert' }),
          el('b', { text: m(f.suggest.cents) }),
          el('small', { text: f.suggest.why }),
          (() => {
            // Il prezzo si può impostare solo sugli alert "sotto un prezzo": quelli con sconto Cardmarket, calo o ritorno disponibile hanno un'altra logica.
            const plain = !r.cmDiscount && !r.dropPct && !r.stock;
            if (!plain || f.suggest.now) return null;
            const same = r.maxPriceCents === f.suggest.cents;
            const b = el('button', { class: 'btn mini', type: 'button', text: same ? 'Già impostato' : `Imposta l’alert a ${m(f.suggest.cents)}` });
            b.disabled = same;
            b.addEventListener('click', async () => {
              b.disabled = true; b.textContent = 'Salvo…';
              const ok = await saveRule({ ...r, minPrice: r.minPriceCents / 100, maxPrice: f.suggest.cents / 100 });
              if (ok) closeSheets(); else { b.disabled = false; b.textContent = `Imposta l’alert a ${m(f.suggest.cents)}`; }
            });
            return b;
          })()) : null,
        el('div', { class: 'ap-rows' }, ...rows.map(([k, v]) => el('div', null, el('span', { text: k }), el('b', { text: v })))),
        f.histNote ? el('p', { class: 'small muted', text: `Lo storico considera ${f.histNote}.` }) : null,
      ];
      const parere = el('div', { class: 'ap-expert' });
      if (a.comment) {
        parere.append(el('div', { class: 'ap-k', text: 'Parere dell’esperto' }), el('p', { text: a.comment }),
          el('small', { class: 'muted', text: 'Generato da un’IA sui dati qui sopra: non è un consiglio finanziario e non conosce notizie fuori dall’app.' }),
          regen('comment', 'Rigenera il parere'));
      } else if (f.listings) {
        const b = el('button', { class: 'btn primary', type: 'button', text: 'Chiedi il parere dell’esperto' });
        b.addEventListener('click', async () => {
          b.disabled = true; b.textContent = 'Sto valutando…';
          try { draw(await api(`/api/appraisal?rule_id=${r.id}&comment=1`)); } catch (e) { b.disabled = false; b.textContent = 'Chiedi il parere dell’esperto'; parere.append(el('p', { class: 'error small', text: e.message })); }
        });
        parere.append(b);
        if (a.note) parere.append(el('p', { class: 'small muted', text: a.note }));
      }
      box.push(parere);
      if (f.listings) {
        const web = el('div', { class: 'ap-expert ap-web' });
        if (a.web) {
          web.append(el('div', { class: 'ap-k', text: 'Parere con ricerca sul web' }), el('p', { text: a.web.text }),
            ...(a.web.sources && a.web.sources.length ? [el('div', { class: 'ap-src' }, ...a.web.sources.map((s) => el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.title })))] : []),
            el('small', { class: 'muted', text: 'Cerca su eBay, Reddit e notizie: i risultati possono essere incompleti o riferirsi a un’altra edizione, controlla le fonti.' }),
            regen('web', 'Rigenera la ricerca'));
        } else {
          const w = el('button', { class: 'btn', type: 'button', text: 'Parere approfondito (cerca sul web)' });
          w.addEventListener('click', async () => {
            w.disabled = true; w.textContent = 'Cerco sul web… (anche 20 secondi)';
            try { draw(await api(`/api/appraisal?rule_id=${r.id}&web=1`)); } catch (e) { w.disabled = false; w.textContent = 'Parere approfondito (cerca sul web)'; web.append(el('p', { class: 'error small', text: e.message })); }
          });
          web.append(w, el('small', { class: 'muted', text: 'Cerca vendite eBay, Reddit e notizie. Costa di più: al massimo 10 al giorno.' }));
          if (a.note) web.append(el('p', { class: 'small muted', text: a.note }));
        }
        box.push(web);
      }
      $('apBody').replaceChildren(...box.filter(Boolean));
    };
    try { draw(await api(`/api/appraisal?rule_id=${r.id}`)); } catch (e) { $('apBody').replaceChildren(el('p', { class: 'error', text: e.message })); }
  }
