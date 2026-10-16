// Piani e funzioni incluse. I nuovi account partono da DEFAULT_PLAN; gli account che esistevano
// prima dei piani sono passati a 'pro' gratis finché non si attiva il pagamento (vedi registry.js).

const UNLIMITED = 100_000;

export const PLANS = {
  free: {
    label: 'Gratuito', price: null,
    maxRules: 3, maxSetRules: 0, maxWish: 10, maxColl: 20, maxScans: 5, scanSec: 300, historyDays: 7, shipping: false, priority: false,
  },
  pro: {
    label: 'Pro', price: '4,99 €/mese o 39 €/anno',
    maxRules: 30, maxSetRules: 1, maxWish: 200, maxColl: 500, maxScans: 200, scanSec: 30, historyDays: 120, shipping: true, priority: true,
  },
  sniper: {
    label: 'Sniper', price: '9,99 €/mese o 79 €/anno',
    maxRules: 100, maxSetRules: UNLIMITED, maxWish: UNLIMITED, maxColl: UNLIMITED, maxScans: 1000, scanSec: 10, historyDays: 120, shipping: true, priority: true,
  },
  owner: {
    label: 'Proprietario', price: null,
    maxRules: 200, maxSetRules: UNLIMITED, maxWish: UNLIMITED, maxColl: UNLIMITED, maxScans: UNLIMITED, scanSec: 10, historyDays: 120, shipping: true, priority: true,
  },
};

export const DEFAULT_PLAN = 'free';
export const PUBLIC_PLANS = ['free', 'pro', 'sniper'];

export function planOf(name) {
  const id = PLANS[name] ? name : DEFAULT_PLAN;
  return { id, ...PLANS[id], unlimited: UNLIMITED };
}

/**
 * Alert che il piano lascia controllare: i primi maxRules su una carta e i primi maxSetRules su un set,
 * nell'ordine in cui sono stati creati. Gli altri restano salvati ma fermi finché il piano non li include.
 */
export function rulesInPlan(rules, plan) {
  let cards = 0;
  let sets = 0;
  const ok = new Set();
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.blueprintId) {
      if (cards < plan.maxRules) { ok.add(r.id); cards++; }
    } else if (sets < plan.maxSetRules) { ok.add(r.id); sets++; }
  }
  return ok;
}
