  // ---------- scanner ----------
  const LANG_LABEL = { en: 'Inglese', jp: 'Giapponese', it: 'Italiano', fr: 'Francese', de: 'Tedesco', es: 'Spagnolo', pt: 'Portoghese', ko: 'Coreano', zh: 'Cinese' };

  /** Riduce la foto (lato lungo 1280 px, JPEG): più veloce da inviare e abbastanza nitida per il numero. */
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Foto non leggibile'));
      img.src = URL.createObjectURL(file);
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scan]');
    if (!b) return;
    $('scanInput').value = '';
    $('scanInput').click();
  });

  $('scanInput').addEventListener('change', async () => {
    const file = $('scanInput').files[0];
    if (!file) return;
    let data;
    try {
      data = await shrinkPhoto(file);
    } catch (e) {
      alert(e.message);
      return;
    }
    $('scanPhoto').src = data;
    $('scanRead').replaceChildren(el('div', { class: 'scan-wait' }, el('span', { class: 'spinner' }), el('span', { text: 'Riconosco la carta…' })));
    $('scanMsg').textContent = '';
    $('scanList').replaceChildren();
    openSheet($('scanDialog'));
    try {
      const r = await api('/api/scan', { method: 'POST', body: JSON.stringify({ image: data }) });
      renderScan(r);
    } catch (e) {
      $('scanRead').replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  });

  function renderScan(r) {
    const sc = r.scan || {};
    const lang = sc.language || '';
    $('scanRead').replaceChildren(
      sc.name ? el('div', { class: 't', text: sc.name }) : el('div', { class: 't', text: 'Carta non riconosciuta' }),
      el('div', { class: 'chips' },
        sc.number ? chip(`N. ${sc.number}${sc.total ? '/' + sc.total : ''}`, 'on') : null,
        lang ? chip(LANG_LABEL[lang] || lang.toUpperCase(), 'lang') : null,
        sc.setCode ? chip(sc.setCode) : null,
        sc.variant ? chip(sc.variant, 'zero') : null,
      ),
      el('div', { class: 'small muted', text: `${r.engine === 'workers-ai' ? 'Riconoscimento Cloudflare' : r.engine === 'claude-opus' ? 'Riconoscimento Claude Opus' : 'Riconoscimento Claude'}${r.limit < 100000 ? ` · ${r.used}/${r.limit} scansioni questo mese` : ''}` }),
    );
    const cands = r.candidates || [];
    $('scanMsg').textContent = !sc.name && !sc.number
      ? 'Non vedo una carta: riprova con più luce, la carta dritta e intera nell’inquadratura.'
      : cands.length ? (cands.length === 1 ? 'Trovata:' : 'È una di queste? Tocca quella giusta.') : 'Nessuna carta corrispondente nell’indice. Prova a cercarla per nome nella scheda Carte.';
    $('scanList').replaceChildren(...cands.map((c, i) => el('div', { class: 'scan-cand' + (i === 0 ? ' top' : '') },
      thumb(c.image),
      el('button', { class: 'linklike scan-info', type: 'button', onclick: () => {
        $('scanDialog').close();
        openCard({ id: c.id, name: c.name, version: c.version, image: c.image, expansionId: c.expansionId, expName: c.expName, currency: 'EUR' });
        if (lang && OWN_LANGS.some(([v]) => v === lang)) own.lang = lang;
      } },
        el('div', { class: 't', text: c.name }),
        el('div', { class: 's', text: [c.version, c.expName].filter(Boolean).join(' · ') }),
      ),
      // Si apre "Ce l'ho" con la lingua letta dalla foto: condizione, copie, gradata e prezzo li scegli tu.
      el('button', { class: 'btn mini', type: 'button', title: 'Aggiungi alla collezione', text: "＋ Ce l'ho", onclick: (ev) => {
        const btn = ev.currentTarget;
        openOwnAdd({ id: c.id, name: c.name, version: c.version, image: c.image, expansionId: c.expansionId, expName: c.expName }, lang, () => {
          btn.textContent = '✓ Aggiunta';
          btn.disabled = true;
        });
      } }),
    )));
  }

