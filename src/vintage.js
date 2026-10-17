// Espansioni vintage famose: era WOTC (1999–2003) ed era EX (2003–2007), internazionali e giapponesi.
// CardTrader non dà date né ere: l'elenco è curato e si confronta con il nome dell'espansione.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const WOTC = [
  '=base set', '=base set 2', '=jungle', '=fossil', '=team rocket', 'gym heroes', 'gym challenge',
  'neo genesis', 'neo discovery', 'neo revelation', 'neo destiny', 'legendary collection',
  '=expedition', 'expedition base set', 'aquapolis', 'skyridge', 'southern islands', 'wizards black star promos', 'wotc promo',
  'best of game', 'pokemon rocket gang', '=expansion pack', 'pokemon jungle', 'mystery of the fossils', 'rocket gang',
  'leaders stadium', 'challenge from the darkness', 'gold silver to a new world', 'crossing the ruins', 'awakening legends',
  'darkness and to light', 'base expansion pack', '=vending series', '=e card', 'split earth', 'mysterious mountains', 'wind from the sea',
  'the town on no map', 'neo premium file', '=gym booster', '=pokemon vs', '=pokemon web',
];

const EX = [
  'ex ruby sapphire', '=ruby sapphire', 'ex sandstorm', '=sandstorm', 'ex dragon', 'ex team magma vs team aqua', 'team magma vs team aqua',
  'ex hidden legends', 'hidden legends', 'ex firered leafgreen', 'firered leafgreen', 'ex team rocket returns', 'team rocket returns',
  'ex deoxys', '=deoxys', 'ex emerald', '=emerald', 'ex unseen forces', '=unseen forces', 'ex delta species', '=delta species',
  'ex legend maker', '=legend maker', 'ex holon phantoms', 'holon phantoms', 'ex crystal guardians', 'crystal guardians',
  'ex dragon frontiers', 'dragon frontiers', 'ex power keepers', 'power keepers', 'nintendo black star promos', '=pop series',
  '=adv', '=pcg', 'golden sky silvery ocean', 'holon research tower', 'miracle crystal', 'clash of the blue sky', 'world champions pack',
  'flight of legends', 'offense and defense of the furthest ends', 'magma vs aqua two ambitions', 'undone seal', 'rulers of the heavens',
  'legend of the emerald',
];

// "=nome": solo nome esatto (parole troppo comuni); altrimenti il nome può avere parole in più (es. "(Japanese)", "1st Edition").
const match = (n, list) => list.some((x) => (x[0] === '=' ? n === x.slice(1) || n === `${x.slice(1)} 1st edition` || n === `${x.slice(1)} japanese`
  : n === x || n.startsWith(`${x} `) || n.endsWith(` ${x}`) || n.includes(` ${x} `)));

/** 'WOTC', 'EX' oppure null. */
export function vintageEra(name) {
  const n = norm(name);
  if (!n) return null;
  if (/\bex\b/.test(n) && match(n, EX)) return 'EX';
  if (match(n, WOTC)) return 'WOTC';
  if (match(n, EX)) return 'EX';
  return null;
}
