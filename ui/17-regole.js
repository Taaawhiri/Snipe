  // ---------- regole ----------
  function fillCardExpansions() {
    const q = $('cardExpFilter').value.trim().toLowerCase();
    const sel = $('cardExp');
    const prev = sel.value;
    const items = expansions.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q));
    sel.replaceChildren(
      el('option', { value: '', text: items.length ? 'Scegli un’espansione…' : 'Nessun risultato' }),
      el('option', { value: 'all', text: 'Tutte le espansioni (cerca per nome)' }),
      ...items.map((e) => el('option', { value: e.id, text: `${e.name} (${e.code})` })),
    );
    if (prev === 'all' || items.some((e) => String(e.id) === prev)) sel.value = prev;
    // mentre scrivi l'elenco resta aperto e mostra le espansioni che corrispondono
    sel.size = q ? Math.min(items.length + 2, 8) : 1;
    sel.classList.toggle('open', !!q);
  }
  $('cardExp').addEventListener('change', () => {
    if ($('cardExp').size > 1) { $('cardExpFilter').value = ''; $('cardExp').size = 1; $('cardExp').classList.remove('open'); }
  });
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


