  // ---------- regole ----------
  // Scelta dell'espansione: elenco nostro (non la tendina di sistema), più recenti in alto, filtri per regione.
  // La <select id="cardExp"> nascosta resta il "valore": chi la legge (caricamento carte) non cambia.
  const REGION_LABEL = { INT: '🌍 International', JAP: '🇯🇵 Giappone', CN: '🇨🇳 Cina', KR: '🇰🇷 Corea', Asia: '🌏 Asia' };
  const REGION_CHIPS = [['', 'Tutte'], ['INT', '🌍 Int'], ['JAP', '🇯🇵 Jap'], ['CN', '🇨🇳 Cina'], ['KR', '🇰🇷 Corea'], ['Asia', '🌏 Asia']];
  let expRegion = '';
  const recentExp = () => { try { return JSON.parse(localStorage.getItem('snipe.recentExp') || '[]'); } catch { return []; } };
  function pushRecent(id) {
    try { localStorage.setItem('snipe.recentExp', JSON.stringify([id, ...recentExp().filter((x) => x !== id)].slice(0, 5))); } catch {}
  }
  function expRow(e) {
    const cur = $('cardExp').value === String(e.id);
    return el('button', { class: 'exp-row' + (cur ? ' sel' : ''), type: 'button', onclick: () => chooseExp(String(e.id)) },
      el('span', { class: 'exp-code', text: (e.code || '').slice(0, 7) }),
      el('span', { class: 'exp-txt' }, el('span', { class: 'nm', text: e.name }), el('span', { class: 'sub', text: e.code || '' })),
      el('span', { class: `exp-reg ${e.region || 'unk'}`, text: e.region ? REGION_LABEL[e.region] || e.region : 'regione in arrivo' }),
    );
  }
  function fillCardExpansions() {
    const q = $('cardExpFilter').value.trim().toLowerCase();
    const sel = $('cardExp');
    const prev = sel.value;
    sel.replaceChildren(el('option', { value: '' }), el('option', { value: 'all' }), ...expansions.map((e) => el('option', { value: e.id })));
    sel.value = prev;
    // Id più alto = espansione pubblicata più di recente su CardTrader.
    const byNew = [...expansions].sort((a, b) => b.id - a.id);
    const items = byNew.filter((e) => (!expRegion || e.region === expRegion) && (!q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q)));
    $('expChips').replaceChildren(...REGION_CHIPS.map(([id, label]) => el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(expRegion === id), text: label, onclick: () => { expRegion = id; fillCardExpansions(); } })));
    const recent = !q && !expRegion ? recentExp().map((id) => expansions.find((e) => String(e.id) === id)).filter(Boolean) : [];
    const sec = (t) => el('div', { class: 'exp-sec', text: t });
    $('expList').replaceChildren(
      ...(q || expRegion ? [] : [el('button', { class: 'exp-row all', type: 'button', onclick: () => chooseExp('all') }, el('span', { class: 'exp-code', text: '🔍' }), el('span', { class: 'exp-txt' }, el('span', { class: 'nm', text: 'Tutte le espansioni' }), el('span', { class: 'sub', text: 'cerca un Pokémon per nome in tutti i set' })))]),
      ...(recent.length ? [sec('Usate di recente'), ...recent.map(expRow)] : []),
      ...(items.length ? [sec(q || expRegion ? `${items.length} espansioni` : 'Dalla più recente'), ...items.slice(0, 300).map(expRow)] : [sec('Nessuna espansione')]),
    );
    const cur = prev === 'all' ? { name: 'Tutte le espansioni' } : expansions.find((e) => String(e.id) === prev);
    $('expPick').querySelector('.ep-name').textContent = cur ? cur.name : 'Scegli un’espansione…';
  }
  function openExpPanel(open) {
    $('expPanel').hidden = !open;
    $('expPick').setAttribute('aria-expanded', String(open));
    if (open) { fillCardExpansions(); $('cardExpFilter').focus({ preventScroll: true }); }
  }
  function chooseExp(id) {
    const sel = $('cardExp');
    if (!sel.querySelector(`option[value="${id}"]`)) sel.append(el('option', { value: id }));
    sel.value = id;
    if (id !== 'all') pushRecent(id);
    $('cardExpFilter').value = '';
    openExpPanel(false);
    fillCardExpansions();
    sel.dispatchEvent(new Event('change'));
  }
  $('expPick').addEventListener('click', () => openExpPanel($('expPanel').hidden));
  $('cardExpFilter').addEventListener('input', fillCardExpansions);

  async function saveRule(r) {
    const err = $('ruleError');
    err.hidden = true;
    try {
      await api('/api/rules', { method: 'POST', body: JSON.stringify(r) });
      await refresh();
      return true;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      return false;
    }
  }


