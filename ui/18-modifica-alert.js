  // ---------- modifica alert ----------
  let editing = null;

  function setEditMode(mode) {
    $('edPrice').hidden = mode !== 'price';
    $('edPercent').hidden = mode !== 'percent';
    $('edCm').hidden = mode !== 'cm';
    $('edDrop').hidden = mode !== 'drop';
    $('edStock').hidden = mode !== 'stock';
  }

  // Alert su un intero set: stesso modulo della modifica, con valori di partenza prudenti.
  $('setAlertBtn').addEventListener('click', () => {
    if (!currentExp) return;
    const condNames = ['Poor', 'Heavily Played', 'Played', 'Moderately Played', 'Slightly Played', 'Near Mint', 'Mint'];
    const rank = $('cardCond').value;
    openEdit({
      expansionId: currentExp.id,
      expansionName: currentExp.name,
      minDiscount: 40,
      minPriceCents: 1000,
      minCondition: rank !== '' ? condNames[Number(rank)] : 'Near Mint',
      language: toRuleLang($('cardLang').value),
      zero: '',
      enabled: true,
      isNew: true,
    });
    $('edTitle').textContent = `Nuovo alert: ${currentExp.name}`;
    $('edSub').textContent = 'Scatta per qualunque carta del set che rispetta i filtri.';
  });

  function openEdit(r) {
    editing = r;
    const legacy = !r.blueprintId;
    $('edTitle').textContent = r.cardName || r.expansionName || 'Modifica alert';
    $('edSub').textContent = r.cardName ? r.expansionName || '' : 'Alert su tutta l’espansione';
    const mode = r.cmDiscount ? 'cm' : r.dropPct ? 'drop' : r.stock ? 'stock' : r.maxPriceCents ? 'price' : 'percent';
    document.querySelector(`input[name="emode"][value="${mode}"]`).checked = true;
    document.querySelectorAll('#editDialog .card-only').forEach((x) => (x.hidden = legacy));
    $('edDropPct').value = r.dropPct || 15;
    $('edDropLabel').textContent = `${$('edDropPct').value}%`;
    $('emodeCmLabel').hidden = !(r.cmId || r.cmDiscount);
    $('edCmPct').value = r.cmDiscount || 20;
    $('edCmLabel').textContent = `${$('edCmPct').value}%`;
    setEditMode(mode);
    $('edMax').value = r.maxPriceCents ? (r.maxPriceCents / 100).toFixed(2) : '';
    $('edPct').value = r.minDiscount || 30;
    $('edPctLabel').textContent = `${$('edPct').value}%`;
    $('edLegacy').hidden = !legacy;
    $('edName').value = r.nameContains || '';
    $('edMinPrice').value = ((r.minPriceCents || 0) / 100).toString();
    $('edZero').value = r.zero || '';
    $('edCond').value = r.minCondition || 'Slightly Played';
    $('edLang').value = r.language || '';
    $('edError').hidden = true;
    openSheet($('editDialog'));
  }

  document.querySelectorAll('input[name="emode"]').forEach((x) =>
    x.addEventListener('change', () => setEditMode(document.querySelector('input[name="emode"]:checked').value)),
  );
  $('edCmPct').addEventListener('input', () => ($('edCmLabel').textContent = `${$('edCmPct').value}%`));
  $('edPct').addEventListener('input', () => ($('edPctLabel').textContent = `${$('edPct').value}%`));
  $('edDropPct').addEventListener('input', () => ($('edDropLabel').textContent = `${$('edDropPct').value}%`));
  $('alertDrop').addEventListener('input', () => ($('alertDropLabel').textContent = `${$('alertDrop').value}%`));

  $('editForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!editing) return;
    const emode = document.querySelector('input[name="emode"]:checked').value;
    const pct = emode === 'percent';
    const body = {
      id: editing.id,
      expansionId: editing.expansionId,
      expansionName: editing.expansionName,
      blueprintId: editing.blueprintId,
      cardName: editing.cardName,
      cardImage: editing.cardImage,
      enabled: editing.enabled !== false,
      priority: !!editing.priority,
      nameContains: editing.blueprintId ? editing.nameContains : $('edName').value,
      minPrice: editing.blueprintId ? 0 : Number($('edMinPrice').value),
      zero: $('edZero').value,
      minCondition: $('edCond').value,
      language: $('edLang').value,
      minDiscount: pct ? Number($('edPct').value) : editing.minDiscount,
    };
    if (editing.cmId) body.cmId = editing.cmId;
    if (emode === 'cm') {
      body.cmDiscount = Number($('edCmPct').value);
      body.cmId = editing.cmId;
    } else if (emode === 'drop') {
      body.dropPct = Number($('edDropPct').value);
    } else if (emode === 'stock') {
      body.stock = true;
    } else if (!pct) {
      const v = Number($('edMax').value);
      if (!(v > 0)) { $('edError').textContent = 'Inserisci un prezzo maggiore di zero.'; $('edError').hidden = false; return; }
      body.maxPrice = v;
    }
    try {
      await api('/api/rules', { method: 'POST', body: JSON.stringify(body) });
      $('editDialog').close();
      await refresh();
    } catch (e) {
      $('edError').textContent = e.message;
      $('edError').hidden = false;
    }
  });

  async function explainRule(r, fresh = false) {
    const d = $('explainDialog');
    $('exTitle').textContent = r.cardName || r.expansionName || 'Alert';
    $('exInfo').textContent = 'Controllo gli annunci attuali…';
    $('exRows').replaceChildren();
    openSheet(d);
    try {
      const data = await api(`/api/explain?rule_id=${r.id}${fresh ? '&fresh=1' : ''}`);
      const ok = data.rows.filter((x) => !x.reasons.length).length;
      if (data.note) { $('exInfo').textContent = data.note; return; }
      $('exInfo').textContent = data.rows.length
        ? `${data.cmTrend ? `Tendenza Cardmarket ${money(Math.round(data.cmTrend * 100))}. ` : ''}${data.total} annunci in vendita, i ${data.rows.length} più economici qui sotto. ${ok ? (ok === 1 ? '1 rispetta i filtri e fa scattare l’alert.' : `${ok} rispettano i filtri e fanno scattare l’alert.`) : 'Nessuno rispetta i filtri.'}`
        : 'CardTrader non mostra annunci per questa carta.';
      const dg = data.diag;
      if (dg) {
        const parts = [dg.scanTs ? `prezzi letti dallo scan ${ago(dg.scanTs)}` : 'lo scan non ha ancora letto i prezzi di questa carta', dg.seenCount === 1 ? '1 annuncio già segnalato' : `${dg.seenCount} annunci già segnalati`];
        if (!dg.enabled) parts.unshift('alert in pausa');
        if (dg.lastError) parts.push(`ultimo errore: ${friendlyError(dg.lastError)}`);
        $('exInfo').append(el('span', { class: 'ex-diag', text: `Controllo in background: ${parts.join(' · ')}.` }));
        // Annunci appena comparsi: si può chiedere una lettura fresca a CardTrader.
        if (!data.fromScan) $('exInfo').append(el('span', { class: 'ex-diag', text: 'Annunci letti adesso da CardTrader.' }));
        if (data.fromScan) $('exInfo').append(el('button', { class: 'btn mini ex-fresh', type: 'button', text: '↻ Leggi ora da CardTrader', onclick: () => explainRule(r, true) }));
      }
      $('exRows').replaceChildren(
        ...data.rows.map((x) =>
          el('div', { class: 'lrow-wrap' },
            el('a', { class: 'lrow', href: x.url, target: '_blank', rel: 'noopener', title: 'Apri su CardTrader' },
              el('span', { class: 'p', text: money(x.cents, x.currency) }),
              el('span', { class: 'd', text: [x.condition, x.language, x.seller].filter(Boolean).join(' · ') + (x.zero ? ' · Zero' : '') }),
              el('span', x.reasons.length ? { class: 'why', text: x.reasons.join(', ') } : { class: 'zero-tag', text: 'Valido' }),
            ),
            x.risky ? el('span', { class: 'chip warn risky-tag', text: 'Troppi annullamenti' }) : null,
          ),
        ),
      );
    } catch (e) {
      $('exInfo').textContent = e.message;
    }
  }

