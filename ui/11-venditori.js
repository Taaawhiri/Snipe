  // ---------- venditori ----------
  const sellerState = (u) => {
    const sel = (state && state.sellers) || { fav: [], block: [] };
    return sel.fav.some((f) => f.username === u) ? 'fav' : sel.block.includes(u) ? 'block' : 'none';
  };

  function sellerButtons(username, country) {
    const st = sellerState(username);
    return el('div', { class: 'seller-acts' },
      el('button', { class: 'btn mini' + (st === 'fav' ? ' on' : ''), type: 'button', title: st === 'fav' ? 'Togli dai preferiti' : 'Salva venditore', text: st === 'fav' ? '★ Salvato' : '☆ Salva',
        onclick: () => setSeller(username, st === 'fav' ? 'none' : 'fav', country) }),
      el('button', { class: 'btn mini' + (st === 'block' ? ' on-bad' : ''), type: 'button', title: st === 'block' ? 'Riammetti' : 'Escludi venditore', text: st === 'block' ? '⛔ Escluso' : '⛔ Escludi',
        onclick: async () => {
          if (st !== 'block' && !(await askConfirm('I suoi annunci non faranno più scattare alert. Puoi riammetterlo quando vuoi.', { title: `Escludere ${username}?`, ok: 'Escludi', danger: true }))) return;
          setSeller(username, st === 'block' ? 'none' : 'block', country);
        } }),
    );
  }

  async function setSeller(username, action, country) {
    try {
      state.sellers = await api('/api/sellers', { method: 'POST', body: JSON.stringify({ username, action, country }) });
      renderSellers();
      if (current && !$('cardDialog').hidden && $('cardDialog').open) openCard(current);
    } catch (e) {
      alert(e.message);
    }
  }

  function renderSellers() {
    const sel = state.sellers || { fav: [], block: [] };
    $('sellerList').replaceChildren(
      ...sel.fav.map((f) => el('div', { class: 'rule' },
        el('div', { class: 'info' },
          el('div', { class: 't', text: `★ ${f.username}${f.country ? ` (${f.country})` : ''}` }),
          el('div', { class: 'e', text: 'Venditore salvato' }),
        ),
        el('div', { class: 'acts' },
          el('button', { class: 'btn', type: 'button', text: 'I suoi annunci', onclick: () => openSeller(f.username) }),
          el('button', { class: 'btn danger', type: 'button', text: 'Togli', onclick: () => setSeller(f.username, 'none') }),
        ),
      )),
      ...sel.block.map((u) => el('div', { class: 'rule off' },
        el('div', { class: 'info' },
          el('div', { class: 't', text: `⛔ ${u}` }),
          el('div', { class: 'e', text: 'Escluso dagli alert' }),
        ),
        el('div', { class: 'acts' }, el('button', { class: 'btn', type: 'button', text: 'Riammetti', onclick: () => setSeller(u, 'none') })),
      )),
      ...(sel.fav.length || sel.block.length ? [] : [el('p', { class: 'muted', text: 'Nessun venditore salvato o escluso.' })]),
    );
  }

  async function openSeller(username) {
    $('slTitle').textContent = username;
    $('slList').replaceChildren(el('p', { class: 'muted', text: 'Cerco i suoi annunci…' }));
    openSheet($('sellerDialog'));
    try {
      const { rows } = await api(`/api/seller?username=${encodeURIComponent(username)}`);
      $('slList').replaceChildren(
        ...(rows.length
          ? rows.map((r) => el('a', { class: 'lrow link', href: cardUrl(r.blueprintId), target: '_blank', rel: 'noopener noreferrer' },
              el('span', { class: 'p', text: money(r.cents, r.currency) }),
              el('span', { class: 'd' }, el('b', { text: r.name || '' }), el('br'), document.createTextNode([r.expansion, r.condition, r.language && r.language.toUpperCase(), r.quantity > 1 && `x${r.quantity}`].filter(Boolean).join(' · '))),
              r.zero ? el('span', { class: 'zero-tag', text: 'Zero' }) : null,
              el('span', { class: 'go', text: '↗' }),
            ))
          : [el('p', { class: 'muted', text: 'Nessun suo annuncio tra le carte lette di recente. Apri qualche espansione o carta e riprova.' })]),
      );
    } catch (e) {
      $('slList').replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  }


  // ---------- controllo di un venditore (Opzioni) ----------
  $('sellerCheckForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('sellerCheckOut');
    const name = $('sellerCheckName').value.trim();
    if (!name) return;
    out.hidden = false;
    out.replaceChildren(el('p', { class: 'muted', text: 'Controllo…' }));
    try {
      const r = await api(`/api/sellercheck?username=${encodeURIComponent(name)}`);
      if (!r.found) { out.replaceChildren(el('p', { class: 'muted', text: 'Non ho annunci recenti di questo venditore, quindi non so dirti nulla. Apri qualche carta o espansione e riprova, oppure controlla di aver scritto bene il nome.' })); return; }
      if (r.stale) { out.replaceChildren(el('p', { class: 'muted', text: 'Gli annunci di questo venditore sono stati letti prima di questo controllo: apri una sua carta o riprova tra qualche minuto, così i dati si aggiornano.' })); return; }
      const lines = [
        r.cancels ? 'Troppi annullamenti: CardTrader lo segnala per ordini annullati.' : 'Nessun problema di annullamenti segnalato.',
        r.limit != null ? `Tetto di vendite: al massimo ${r.limit} carte ogni 24 ore. È solo un'informazione, non conta come problema.` : 'Nessun tetto di vendite.',
      ];
      out.replaceChildren(
        el('p', { class: r.risky ? 'chip warn risky-tag' : 'zero-tag', text: r.risky ? 'Ha problemi' : 'Nessun problema segnalato' }),
        el('p', { class: 'small', text: `${r.username}${r.country ? ` (${r.country})` : ''} · ${r.listings} ${r.listings === 1 ? 'annuncio letto' : 'annunci letti'}` }),
        ...lines.map((t) => el('p', { class: 'muted small', text: t })),
        el('p', { class: 'muted small', text: 'CardTrader non dà valutazioni né anzianità: nessun segnale non vuol dire per forza venditore esperto.' }),
      );
    } catch (err) { out.replaceChildren(el('p', { class: 'error', text: err.message })); }
  });
