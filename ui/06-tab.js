  // ---------- tab ----------
  function goTab(name) {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    for (const t of ['alerts', 'cards', 'deals', 'rules', 'settings']) $(`tab-${t}`).hidden = t !== name;
    if (name === 'deals') loadDeals();
    if (name === 'alerts' && !$('collView').hidden) loadCollection();
    if (name === 'settings' && isOwner()) loadAdmin();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.go)));

  // Eliminare un alert cancella anche i suoi avvisi, quindi chiediamo conferma.
  function confirmDelete(r) {
    return window.confirm(`Eliminare l'alert "${r.cardName || r.expansionName}"? Anche i suoi avvisi verranno cancellati.`);
  }

  async function markAlert(a, mark) {
    try {
      await api('/api/alerts/mark', { method: 'POST', body: JSON.stringify({ id: a.id, mark }) });
      a.mark = mark;
      refresh();
    } catch (e) {
      alert(e.message);
    }
  }
  document.querySelectorAll('input[name="afilter"]').forEach((r) => r.addEventListener('change', render));

  function renderWish() {
    const wl = $('wishList');
    const wish = state.wish || [];
    const have = new Set(wish.map((w) => w.id));
    const missing = new Set(state.rules.filter((r) => r.blueprintId && !have.has(r.blueprintId)).map((r) => r.blueprintId)).size;
    $('wishFromRules').hidden = !missing;
    $('wishFromRules').textContent = `♥ Aggiungi le carte dei tuoi alert (${missing})`;
    wl.replaceChildren(
      ...(wish.length
        ? wish.map((w) => {
            const last = w.last;
            const trend = last && w.prev && w.prev !== last ? last.min - w.prev.min : null;
            return el('div', { class: 'rule wish' },
              thumb(w.image),
              el('div', { class: 'info' },
                el('div', null,
                  el('div', { class: 't', text: w.name }),
                  el('div', { class: 'e', text: w.expName || '' }),
                ),
                el('div', { class: 'chips' },
                  chip(last ? `Da ${money(last.min)}` : 'Prezzo in arrivo…', 'on'),
                  last && last.zero != null ? chip(`Zero ${money(last.zero)}`, 'zero') : null,
                  trend ? chip(`${trend < 0 ? '▼' : '▲'} ${money(Math.abs(trend))} in 7 giorni`, trend < 0 ? 'good' : 'warn') : null,
                ),
              ),
              el('div', { class: 'acts' },
                el('button', { class: 'btn', type: 'button', text: 'Apri', onclick: () => openCard({ id: w.id, name: w.name, image: w.image, expansionId: w.expansionId, expName: w.expName, currency: 'EUR', fromWish: true }) }),
                el('button', { class: 'btn danger', type: 'button', text: 'Togli', onclick: () => toggleWish({ id: w.id }, true) }),
              ),
            );
          })
        : [el('p', { class: 'muted', text: 'La lista è vuota.' })]),
    );
  }

  const wishFromRule = (r) => ({ id: r.blueprintId, name: r.cardName, image: r.cardImage, expansionId: r.expansionId, expName: r.expansionName });

  async function wishAllFromRules() {
    const have = new Set((state.wish || []).map((w) => w.id));
    const todo = [...new Map(state.rules.filter((r) => r.blueprintId && !have.has(r.blueprintId)).map((r) => [r.blueprintId, r])).values()];
    for (const r of todo) {
      try {
        const c = wishFromRule(r);
        state.wish = await api('/api/wish', { method: 'POST', body: JSON.stringify({ id: c.id, name: c.name, image: c.image, expansionId: c.expansionId, expName: c.expName }) });
      } catch (e) {
        alert(e.message); // per esempio il limite del piano
        break;
      }
    }
    refresh();
  }

  async function toggleWish(c, remove) {
    try {
      state.wish = await api('/api/wish', { method: 'POST', body: JSON.stringify({ id: c.id, name: c.name + (c.version ? ` (${c.version})` : ''), image: c.image, expansionId: c.expansionId || (dlgExp && dlgExp.id), expName: c.expName || (dlgExp && dlgExp.name), remove }) });
      renderWish();
      updateWishBtn();
      refresh();
    } catch (e) {
      alert(e.message);
    }
  }

  function updateWishBtn() {
    if (!current) return;
    const inWish = (state.wish || []).some((w) => w.id === current.id);
    $('dlgWish').textContent = inWish ? '★ Nei desideri' : '☆ Desideri';
    $('dlgWish').classList.toggle('on', inWish);
    $('dlgWish').title = inWish ? 'Togli dalla lista dei desideri' : 'Aggiungi alla lista dei desideri';
  }
  $('wishFromRules').addEventListener('click', wishAllFromRules);
  $('dlgWish').addEventListener('click', () => current && toggleWish(current, (state.wish || []).some((w) => w.id === current.id)));

  /** Grafico dei prezzi giornalieri: linea piena = più basso, tratteggiata = con Zero. */
  async function renderHistory(c) {
    const box = $('dlgHist');
    box.hidden = true;
    let h;
    try {
      h = await api(`/api/history?blueprint_id=${c.id}`);
    } catch {
      return;
    }
    if (current !== c) return;
    if (!h.length) return;
    box.hidden = false;
    const W = 320, H = 110, P = 6;
    const vals = h.flatMap((p) => [p.min, p.zero]).filter((v) => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const x = (i) => (h.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (h.length - 1));
    const y = (v) => (hi === lo ? H / 2 : H - P - ((v - lo) * (H - 2 * P)) / (hi - lo));
    const line = (k) => h.map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`)).filter(Boolean).join(' ');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'histsvg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Andamento del prezzo più basso');
    for (const [k, cls] of [['zero', 'hz'], ['min', 'hm']]) {
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', line(k));
      pl.setAttribute('class', cls);
      svg.append(pl);
      const last = [...h].reverse().find((p) => p[k] != null);
      if (last) {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', x(h.lastIndexOf(last)));
        dot.setAttribute('cy', y(last[k]));
        dot.setAttribute('r', 3.5);
        dot.setAttribute('class', cls);
        svg.append(dot);
      }
    }
    const first = h[0], last = h[h.length - 1];
    box.replaceChildren(
      el('div', { class: 'histhead' },
        el('span', { class: 'cmtitle', text: `Prezzo più basso · ${h.length === 1 ? 'da oggi' : `ultimi ${h.length} giorni`}` }),
        el('span', { class: 'small muted', text: `min ${money(lo)} · max ${money(hi)}` }),
      ),
      svg,
      el('div', { class: 'histlegend small' },
        el('span', { class: 'lg hm', text: `Più basso ${money(last.min)}` }),
        last.zero != null ? el('span', { class: 'lg hz', text: `Con Zero ${money(last.zero)}` }) : null,
        h.length > 1 ? el('span', { class: 'muted', text: `dal ${first.d.slice(8, 10)}/${first.d.slice(5, 7)}` }) : null,
      ),
    );
  }

