import { DurableObject } from 'cloudflare:workers';

// Registro degli account: chiave per firmare le sessioni, utenti e piani, e quale server dati usa ciascuno.
// L'account del proprietario (quello con lo stesso token del Secret CARDTRADER_TOKEN) riusa il server
// dati 'main', così alert, storico e notifiche di prima restano dove sono.

export class Registry extends DurableObject {
  async get(key, fallback) {
    const v = await this.ctx.storage.get(key);
    return v === undefined ? fallback : v;
  }

  async secret() {
    let s = await this.get('secret', null);
    if (!s) {
      const b = crypto.getRandomValues(new Uint8Array(32));
      s = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
      await this.ctx.storage.put('secret', s);
    }
    return s;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const json = (d, status = 200) => Response.json(d, { status });

    // Arrivo dei piani: chi aveva già un account resta Pro gratis finché il pagamento non è attivo.
    if (!(await this.get('plansV1', false))) {
      const users = await this.get('users', {});
      for (const u of Object.values(users)) if (u.plan === 'free') u.plan = 'pro';
      await this.ctx.storage.put({ users, plansV1: true });
    }

    if (url.pathname === '/secret') return json({ secret: await this.secret() });

    // Limite ai tentativi di accesso: 10 ogni 15 minuti per indirizzo IP (in memoria: basta contro i tentativi a raffica).
    if (url.pathname === '/attempt' && req.method === 'POST') {
      const { ip } = await req.json();
      const now = Date.now();
      this.attempts = this.attempts || new Map();
      const list = (this.attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
      if (list.length >= 10) return json({ ok: false, retryIn: Math.ceil((list[0] + 15 * 60_000 - now) / 60_000) });
      list.push(now);
      this.attempts.set(ip, list);
      if (this.attempts.size > 5000) this.attempts.clear();
      return json({ ok: true });
    }

    if (url.pathname === '/login' && req.method === 'POST') {
      const { userId, legacyId, appName, owner, defaultPlan } = await req.json();
      const users = await this.get('users', {});
      const id = String(userId);
      // Account registrato con l'ID dell'app (versioni precedenti): lo spostiamo sull'ID utente, con un alias
      // perché le sessioni già aperte continuino a funzionare.
      if (legacyId && legacyId !== id && users[legacyId] && !users[id]) {
        users[id] = users[legacyId];
        delete users[legacyId];
        const aliases = await this.get('aliases', {});
        aliases[legacyId] = id;
        await this.ctx.storage.put('aliases', aliases);
      }
      const prev = users[id];
      const mainTaken = Object.entries(users).some(([uid, u]) => uid !== id && u.doName === 'main');
      users[id] = {
        ...(prev || {}), // conserva sospensione e note impostate dalla pagina admin
        appName: String(appName || '').slice(0, 80),
        created: prev ? prev.created : Date.now(),
        lastLogin: Date.now(),
        plan: owner ? 'owner' : prev ? prev.plan : defaultPlan,
        // Il proprietario usa sempre il server dati 'main' (quello dell'account unico di prima),
        // anche se a un primo accesso non era stato riconosciuto.
        doName: owner && !mainTaken ? 'main' : prev ? prev.doName : `u:${id}`,
      };
      await this.ctx.storage.put('users', users);
      return json({ id, ...users[id] });
    }

    if (url.pathname === '/remove' && req.method === 'POST') {
      const { id } = await req.json();
      const users = await this.get('users', {});
      delete users[id];
      const aliases = await this.get('aliases', {});
      for (const [k, v] of Object.entries(aliases)) if (v === id) delete aliases[k];
      await this.ctx.storage.put({ users, aliases });
      return json({ ok: true });
    }

    // Errori del servizio, per il proprietario: ultimi 50, con conteggio per tipo.
    if (url.pathname === '/error' && req.method === 'POST') {
      const e = await req.json();
      const errors = await this.get('errors', []);
      const key = String(e.where || '') + '|' + String(e.message || '').slice(0, 80);
      const prev = errors.find((x) => x.key === key);
      let notify = false;
      if (prev) {
        prev.count++;
        prev.last = Date.now();
        prev.user = e.user || prev.user;
        // Stesso errore: una notifica al massimo ogni 6 ore.
        if (Date.now() - (prev.notified || 0) > 6 * 3600_000) { prev.notified = Date.now(); notify = true; }
      } else {
        errors.unshift({ key, where: String(e.where || '').slice(0, 60), message: String(e.message || '').slice(0, 300), user: e.user || null, first: Date.now(), last: Date.now(), count: 1, notified: Date.now() });
        notify = true;
      }
      errors.sort((a, b) => b.last - a.last);
      await this.ctx.storage.put('errors', errors.slice(0, 50));
      return json({ notify });
    }

    if (url.pathname === '/errors') return json(await this.get('errors', []));

    if (url.pathname === '/errors/clear' && req.method === 'POST') {
      await this.ctx.storage.put('errors', []);
      return json({ ok: true });
    }

    if (url.pathname === '/user') {
      const users = await this.get('users', {});
      let id = url.searchParams.get('id');
      if (!users[id]) id = (await this.get('aliases', {}))[id] || id;
      const u = users[id];
      return u ? json({ id, ...u }) : json({ error: 'Pagina non trovata: ricarica l’app.' }, 404);
    }

    if (url.pathname === '/users') {
      const users = await this.get('users', {});
      return json(Object.entries(users).map(([id, u]) => ({ id, ...u })));
    }

    if (url.pathname === '/update' && req.method === 'POST') {
      const { id, patch } = await req.json();
      const users = await this.get('users', {});
      if (!users[id]) return json({ error: 'Utente non trovato' }, 404);
      users[id] = { ...users[id], ...patch };
      await this.ctx.storage.put('users', users);
      return json({ id, ...users[id] });
    }

    if (url.pathname === '/plan' && req.method === 'POST') {
      const { id, plan } = await req.json();
      const users = await this.get('users', {});
      if (!users[id]) return json({ error: 'Utente non trovato' }, 404);
      users[id].plan = String(plan);
      await this.ctx.storage.put('users', users);
      return json({ id, ...users[id] });
    }

    return json({ error: 'Pagina non trovata: ricarica l’app.' }, 404);
  }
}
