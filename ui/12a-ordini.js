  // ---------- importa in collezione le carte degli ordini CardTrader (lettura al momento, non si salva niente) ----------
  const ORD_LANG = { en: 'EN', jp: 'JP', it: 'IT', fr: 'FR', de: 'DE', es: 'ES', pt: 'PT', ko: 'KO', zh: 'ZH', cn: 'CN' };

  async function openOrdersImport() {
    let data;
    const open = $('ordersImportOpen');
    const label = open.textContent;
    open.disabled = true;
    open.textContent = 'Leggo i tuoi ordini…';
    try { data = await api('/api/orders/importable'); } catch (e) { await alert(e.message); return; } finally { open.disabled = false; open.textContent = label; }
    const fresh = data.items.filter((it) => !it.dup);
    const dups = data.items.filter((it) => it.dup);
    const sel = new Set(fresh.map((it) => it.iid)); // le nuove sono già spuntate, quelle già in collezione no
    const ov = el('div', { class: 'cs-overlay', onclick: (e) => { if (e.target === ov) ov.remove(); } });
    const body = el('div', { class: 'cs-list im-list' });
    const btn = el('button', { class: 'btn primary', type: 'button' });
    const box = (it) => {
      const c = el('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) sel.add(it.iid); else sel.delete(it.iid); paint(); } });
      c.checked = sel.has(it.iid); // come proprietà: l'attributo "checked: false" varrebbe comunque come spuntato
      return c;
    };
    const row = (it) => el('label', { class: 'im-row ord-row' },
      box(it),
      el('span', { class: 'ord-main' },
        el('b', { text: `${it.qty > 1 ? it.qty + '× ' : ''}${it.name}` }),
        el('small', { text: [it.expansion, it.condition && condShort(it.condition), it.lang && (ORD_LANG[it.lang] || it.lang.toUpperCase()), it.reverse && 'Reverse', it.first && '1ª ed.', it.cents != null && money(it.cents)].filter(Boolean).join(' · ') })));
    const paint = () => {
      btn.textContent = sel.size ? `Importa ${sel.size} ${sel.size === 1 ? 'carta' : 'carte'}` : 'Nessuna carta scelta';
      btn.disabled = !sel.size;
    };
    body.replaceChildren(
      el('p', { class: 'small muted', text: `Dai tuoi ${data.orders} ordini su CardTrader. Si aggiungono con il prezzo pagato, la condizione e la lingua dell'ordine. Le carte gradate non si importano (negli ordini manca il voto).` }),
      ...(fresh.length ? [el('h3', { class: 'oc-h', text: `Nuove (${fresh.length})` }), ...fresh.map(row)] : [el('p', { class: 'muted', text: 'Nessuna carta nuova da importare.' })]),
      ...(dups.length ? [el('h3', { class: 'oc-h', text: `Forse già in collezione (${dups.length})` }), el('p', { class: 'small muted', text: 'Stessa carta e stessa lingua di una che hai già, magari aggiunta a mano: non sono spuntate. Spuntale solo se sono copie in più.' }), ...dups.map(row)] : []),
    );
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Importo…';
      try {
        const r = await api('/api/orders/import', { method: 'POST', body: JSON.stringify({ iids: [...sel] }) });
        ov.remove();
        toast(`✓ ${r.added} ${r.added === 1 ? 'carta aggiunta' : 'carte aggiunte'}${r.merged ? `, ${r.merged} unite a quelle che avevi` : ''}${r.limited ? `, ${r.limited} non entrano nel piano` : ''}`);
        loadCollection();
      } catch (e) {
        paint();
        await alert(e.message);
      }
    };
    paint();
    ov.append(el('div', { class: 'cs-sheet im', role: 'dialog', 'aria-label': 'Importa dagli ordini CardTrader' },
      el('div', { class: 'cs-grab' }), el('div', { class: 'cs-title', text: 'Importa dagli ordini CardTrader' }), body,
      el('div', { class: 'cs-actions' }, el('button', { class: 'btn', type: 'button', text: 'Chiudi', onclick: () => ov.remove() }), btn)));
    document.body.append(ov);
  }
  $('ordersImportOpen').addEventListener('click', openOrdersImport);
