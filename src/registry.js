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

    if (url.pathname === '/secret') return json({ secret: await this.secret() });

    if (url.pathname === '/login' && req.method === 'POST') {
      const { userId, name, owner, defaultPlan } = await req.json();
      const users = await this.get('users', {});
      const id = String(userId);
      const prev = users[id];
      const hasMain = Object.values(users).some((u) => u.doName === 'main');
      users[id] = {
        name: String(name || '').slice(0, 80),
        created: prev ? prev.created : Date.now(),
        lastLogin: Date.now(),
        plan: prev ? prev.plan : owner ? 'owner' : defaultPlan,
        doName: prev ? prev.doName : owner && !hasMain ? 'main' : `u:${id}`,
      };
      await this.ctx.storage.put('users', users);
      return json({ id, ...users[id] });
    }

    if (url.pathname === '/user') {
      const users = await this.get('users', {});
      const u = users[url.searchParams.get('id')];
      return u ? json({ id: url.searchParams.get('id'), ...u }) : json({ error: 'not found' }, 404);
    }

    if (url.pathname === '/users') {
      const users = await this.get('users', {});
      return json(Object.entries(users).map(([id, u]) => ({ id, ...u })));
    }

    if (url.pathname === '/plan' && req.method === 'POST') {
      const { id, plan } = await req.json();
      const users = await this.get('users', {});
      if (!users[id]) return json({ error: 'Utente non trovato' }, 404);
      users[id].plan = String(plan);
      await this.ctx.storage.put('users', users);
      return json({ id, ...users[id] });
    }

    return json({ error: 'not found' }, 404);
  }
}
