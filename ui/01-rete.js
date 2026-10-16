  // ---------- rete ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      credentials: 'same-origin',
      headers: opts.body ? { 'content-type': 'application/json' } : {},
    });
    if (res.status === 401) {
      showLogin('');
      throw new Error('401');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
    return data;
  }

