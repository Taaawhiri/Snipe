// Piani e funzioni incluse. Per ora tutti i nuovi account partono da DEFAULT_PLAN:
// per mettere a pagamento una funzione basta toglierla da 'free' e assegnare 'pro' a chi paga.

export const PLANS = {
  free: { label: 'Gratuito', maxRules: 30, priority: true, setAlerts: true, maxWish: 200, minScanSec: 10 },
  pro: { label: 'Pro', maxRules: 100, priority: true, setAlerts: true, maxWish: 500, minScanSec: 10 },
  owner: { label: 'Proprietario', maxRules: 200, priority: true, setAlerts: true, maxWish: 1000, minScanSec: 10 },
};

export const DEFAULT_PLAN = 'free';

export function planOf(name) {
  return PLANS[name] ? { id: name, ...PLANS[name] } : { id: DEFAULT_PLAN, ...PLANS[DEFAULT_PLAN] };
}
