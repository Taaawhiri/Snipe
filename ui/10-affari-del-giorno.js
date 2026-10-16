  // ---------- affari del giorno ----------
  let dealsAt = 0;
  let dealsData = null;
  document.querySelectorAll('input[name="dmode"]').forEach((r) => r.addEventListener('change', () => dealsData && renderDeals(dealsData)));
  const plain = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  $('dealsSearch').addEventListener('input', () => dealsData && renderDeals(dealsData));
  async function loadDeals() {
    if (Date.now() - dealsAt < 5 * 60_000 && dealsData) return;
    dealsAt = Date.now();
    $('dealsMsg').textContent = 'Carico gli affari…';
    try {
      dealsData = await api('/api/deals');
      renderDeals(dealsData);
    } catch (e) {
      $('dealsMsg').textContent = e.message;
    }
  }

  function renderDeals(all) {
    {
      const zero = (document.querySelector('input[name="dmode"]:checked') || {}).value === 'zero';
      const q = plain($('dealsSearch').value).trim();
      const base = zero ? all.itemsZero || [] : all.items;
      const d = { ...all, items: q ? base.filter((it) => plain(it.name).includes(q)) : base };
      $('dealsMsg').textContent = q && !d.items.length
        ? `Nessun affare per “${$('dealsSearch').value.trim()}” tra quelli di oggi.`
        : d.items.length
        ? `${d.items.length} affari · aggiornati ${ago(d.ts)} · ${d.sets.length} espansioni controllate${d.popular && d.popular.length ? ` (${d.popular.length} tra le più ricercate)` : ''}`
        : zero && all.items.length ? 'Per ora nessun annuncio Zero è abbastanza sotto gli altri. Riprova più tardi.' : 'Sto raccogliendo i primi dati: le espansioni si controllano una ogni 10 minuti. Riprova più tardi.';
      $('dealsGrid').replaceChildren(
        ...d.items.map((it, i) => el('div', { class: 'tile', style: `--i:${Math.min(i, 24)}` },
          el('button', { class: 'tile-main', type: 'button', onclick: () => openCard({ id: it.id, name: it.name, image: it.image, expansionId: it.expansionId, expName: it.expName, currency: it.currency, lowest: it.cents, cm: { trend: it.trendCents / 100 } }) },
            el('div', { class: 'art' },
              it.image ? el('img', { src: it.image, alt: '', loading: 'lazy' }) : el('div', { class: 'noimg', text: 'Nessuna immagine' }),
              el('span', { class: 'pricepill', text: money(it.cents, it.currency) }),
              el('span', { class: 'zeropill deal', text: `−${Math.round(it.discount * 100)}%` }),
            ),
            el('div', { class: 'info' },
              el('div', { class: 'nm', text: it.name }),
              el('div', { class: 'sub', text: [it.expName, it.language && it.language.toUpperCase(), it.zero && 'Zero'].filter(Boolean).join(' · ') }),
              it.refCents ? el('div', { class: 'sub', text: `Prezzo tipico CardTrader ${money(it.refCents, it.currency)}` }) : null,
              it.trendCents ? el('div', { class: 'cmtxt', text: `Cardmarket tendenza ${money(it.trendCents, it.currency)}` }) : null,
            ),
          ),
        )),
      );
    }
  }

