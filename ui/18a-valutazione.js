  // ---------- Valutazione del prezzo di un alert ----------
  // Il voto e i numeri li calcola il server dai dati; il parere in parole lo scrive Claude solo se lo chiedi (costa un po').
  async function appraiseRule(r) {
    const d = $('appraisalDialog');
    $('apTitle').textContent = r.cardName || 'Valutazione';
    $('apBody').replaceChildren(el('p', { class: 'muted small', text: 'Valuto il prezzo…' }));
    openSheet(d);
    const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`);
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
          f.listings && f.pct90 != null ? el('small', { text: `Il prezzo è al ${Math.round(f.pct90 * 100)}° percentile degli ultimi 90 giorni (0 = il più basso).` }) : null),
        f.outlierLow ? el('p', { class: 'small ap-warn', text: 'Attenzione: l’annuncio più basso è molto sotto gli altri. Controlla condizione, lingua e venditore.' }) : null,
        el('div', { class: 'ap-rows' }, ...rows.map(([k, v]) => el('div', null, el('span', { text: k }), el('b', { text: v })))),
      ];
      const parere = el('div', { class: 'ap-expert' });
      if (a.comment) {
        parere.append(el('div', { class: 'ap-k', text: 'Parere dell’esperto' }), el('p', { text: a.comment }),
          el('small', { class: 'muted', text: 'Generato da un’IA sui dati qui sopra: non è un consiglio finanziario e non conosce notizie fuori dall’app.' }));
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
            el('small', { class: 'muted', text: 'Cerca su eBay, Reddit e notizie: i risultati possono essere incompleti o riferirsi a un’altra edizione, controlla le fonti.' }));
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
