// Tests des décisions "métier" (boutique, captures, Pokédex) — `node --test test/`
// Formats repris du bundle réel du jeu (v125) : items.effect, pokemon.evolutions {level|item, toDex, region?}.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./dom-stub');
require('../pokedice-bot.user.js');
const P = global.PokeBot; // en mode navigateur, le script s'expose sur window.PokeBot

const item = (key, kind, field, value, price, shopBadges = 0) => ({ key, name: key, price, inShop: true, shopBadges, effect: { kind, [field]: value } });
const mon = (dex, name, t1, baseHp, maxHp, evolutions = [], catchValue) => ({ dex, name, type1: t1, type2: null, baseHp, maxHp, speed: 5, rerolls: 1, dice: [{ type: 'normal', count: 1 }], milestones: [], evolutions, catchValue });

const bundle = {
  pokemon: [
    mon(10, 'Caterpie', 'bug', 12, 231, [{ level: 7, toDex: 11 }], 2),
    mon(11, 'Metapod', 'bug', 12, 241, [{ level: 10, toDex: 12 }]),
    mon(12, 'Butterfree', 'bug', 12, 251),
    mon(16, 'Pidgey', 'normal', 12, 221, [{ level: 18, toDex: 17 }]),
    mon(17, 'Pidgeotto', 'normal', 12, 300, [{ level: 36, toDex: 18 }]),
    mon(18, 'Pidgeot', 'normal', 12, 400),
    mon(25, 'Pikachu', 'electric', 12, 211, [{ item: 'thunder-stone', level: null, toDex: 26 }], 6),
    mon(26, 'Raichu', 'electric', 12, 300),
    mon(104, 'Cubone', 'ground', 12, 221, [{ level: 28, notInRegion: 'alola', toDex: 105 }, { level: 28, region: 'alola', toDex: 10115 }]),
    mon(105, 'Marowak', 'ground', 12, 300),
    mon(10115, 'Marowak-Alola', 'fire', 12, 300),
    mon(999, 'Gros', 'normal', 50, 600),
  ],
  items: [
    item('potion', 'heal', 'amount', 20, 15), item('super-potion', 'heal', 'amount', 50, 35, 1), item('hyper-potion', 'heal', 'amount', 120, 80, 4),
    item('poke-ball', 'ball', 'bonus', 1, 20), item('great-ball', 'ball', 'bonus', 2, 50, 2), item('ultra-ball', 'ball', 'bonus', 3, 100, 4),
    { ...item('master-ball', 'ball', 'bonus', 10, 1000), inShop: false },
    { key: 'thunder-stone', name: 'thunder-stone', price: 200, inShop: true, shopBadges: 4, effect: { kind: 'stone' } },
  ],
  areas: [
    { id: 'forest', name: 'Viridian Forest', regionId: 'kanto', orderIndex: 3, minLevel: 4, maxLevel: 8, encounterWeights: { wild: 6, trainer: 2, item: 1, center: 1 }, wildPool: [{ dex: 10, weight: 50, minLevel: 4, maxLevel: 6 }, { dex: 25, weight: 5, minLevel: 4, maxLevel: 6 }] },
    { id: 'cave', name: 'Cave', regionId: 'kanto', orderIndex: 5, minLevel: 6, maxLevel: 10, legendaryBoss: [{ dex: 26, level: 30, raid: true }], wildPool: [{ dex: 104, weight: 50, minLevel: 6, maxLevel: 10 }] },
    { id: 'route1', name: 'Route 1', regionId: 'kanto', orderIndex: 1, minLevel: 2, maxLevel: 5, backtrackMultiplier: 0.5, encounterWeights: { wild: 8, trainer: 0 }, wildPool: [{ dex: 16, weight: 50, minLevel: 2, maxLevel: 5 }] },
  ],
  regions: [{ id: 'kanto', dexRange: [1, 151] }],
  typeChart: [], config: { hpMultiplier: 1, maxTeamSize: 3, goldMultiplier: 0.5 },
};

function setup({ box, team, pokedex, inventory = {}, gold = 0, badges = 0, area = 'route1' }) {
  const B = P.buildData(null);
  const D = P.buildData({ ...bundle, diceTypes: Object.values(B.dice) });
  D.chart = B.chart;
  P.Rt.D = D; P.Rt.E = P.Engine(D);
  for (const p of bundle.pokemon) P.Rt.dexName.set(p.dex, p.name);
  const save = {
    gold, inventory, pokedex, currentAreaId: area, region: 'kanto', comboLevels: {}, dieLevels: {},
    areaProgress: { route1: { cleared: true, gymsDefeated: Array(badges).fill('x') }, forest: {} },
    box: box.map(([id, dex, level]) => ({ id, dex, level, currentHp: 10 })), team,
  };
  localStorage.setItem('pokedice.save', JSON.stringify(save));
  return save;
}

test('soin : palier selon les PV de l’équipe (40 PV → Potion, 300 PV → Super Potion si pas mieux)', () => {
  let save = setup({ box: [['a', 16, 5]], team: ['a'], pokedex: [16], badges: 1 });
  let h = P.healTierFor(save);
  assert.equal(P.shopTiers('heal', 'amount', save)[h.idx].key, 'potion', `${h.maxHp} PV → Potion`);
  save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999], badges: 1 });
  h = P.healTierFor(save);
  assert.equal(P.shopTiers('heal', 'amount', save)[h.idx].key, 'super-potion', 'Hyper Potion pas encore débloquée → la plus forte dispo');
  save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999], badges: 4 });
  h = P.healTierFor(save);
  assert.equal(P.shopTiers('heal', 'amount', save)[h.idx].key, 'hyper-potion');
});

test('stock : les objets plus forts comptent (3 Super + 3 Hyper couvrent un besoin de Super Potion)', () => {
  P.setMode('progression', { persist: false });
  // N.10 → 100 PV max → besoin de 50 PV par soin → palier Super Potion
  const save = setup({ box: [['a', 999, 10]], team: ['a'], pokedex: [999], badges: 4, gold: 2000, inventory: { 'super-potion': 3, 'hyper-potion': 3, 'poke-ball': 30, 'ultra-ball': 5 } });
  const wish = P.shopWishlist(save);
  assert.ok(!wish.some((w) => w.family === 'heal'), 'stock de soins déjà suffisant : ' + JSON.stringify(wish));
  // 9 Potions (20 PV) valent 3 Super Potions (50 PV) : pas d'urgence
  const w2 = P.shopWishlist(setup({ box: [['a', 999, 10]], team: ['a'], pokedex: [999], badges: 4, gold: 2000, inventory: { potion: 9, 'poke-ball': 30, 'ultra-ball': 5 } }));
  assert.ok(!w2.find((w) => w.family === 'heal')?.urgent, 'les Potions comptent à leur valeur en PV');
  // 30 Poké Balls : passer aux Super Balls n'est pas une urgence
  assert.ok(!wish.find((w) => w.family === 'ball')?.urgent, 'montée en gamme, pas urgence');
});

test('capture : chance exacte du jeu (dé 1–6 + bonus ≥ difficulté)', () => {
  assert.equal(P.catchPct(2, 0), 5 / 6, 'difficulté 2 sans Ball : 5 faces sur 6');
  assert.equal(P.catchPct(6, 1), 2 / 6, 'difficulté 6 + Poké Ball : il faut 5 ou 6');
  assert.equal(P.catchPct(4, 3), 1, 'difficulté 4 + Hyper Ball : toujours');
  assert.equal(P.catchPct(9, 0), 0);
});

test('Balls : achète la Ball qui suffit pour chaque espèce manquante, pas plus', () => {
  P.setMode('pokedex', { persist: false });
  // Forêt : Chenipan (diff. 2) et Pikachu (diff. 6) absents du Pokédex
  const save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16], badges: 4, gold: 3000, inventory: {}, area: 'forest' });
  const plan = P.ballPlan(save);
  const by = Object.fromEntries(plan.species.map((x) => [x.dex, x]));
  assert.equal(by[10].key, 'poke-ball', 'Chenipan (difficulté 2) : la Poké Ball donne 100 % (nouvelle espèce : la meilleure chance)');
  assert.equal(by[25].key, 'ultra-ball', 'Pikachu : aucune Ball n’atteint 90 % → la meilleure (67 %)');
  const wish = P.shopWishlist(save);
  const rare = wish.find((w) => w.key === 'ultra-ball');
  assert.equal(rare.qty, 2 + P.CONFIG.stock.rareBall, '2 lancers espérés pour Pikachu + réserve chromatiques');
  assert.ok(rare.urgent, 'espèce manquante ICI sans la Ball qui va bien');
  assert.ok(!wish.some((w) => w.key === 'great-ball'), 'la Super Ball ne sert à rien ici');
  // Zone sans espèce manquante : juste le minimum de Poké Balls + la réserve
  const save2 = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16], badges: 4, gold: 3000, inventory: { 'poke-ball': 40, 'ultra-ball': 10 } });
  assert.ok(!P.shopWishlist(save2).some((w) => /ball/.test(w.family)), 'stock suffisant : rien à acheter');
});

test('capture : Ball choisie à l’écran selon l’enjeu', () => {
  P.setMode('progression', { persist: false });
  const opts = [
    { t: 'sans', pct: 33, price: 0, bonus: 0 }, { t: 'poke', pct: 50, price: 20, bonus: 1 },
    { t: 'super', pct: 67, price: 50, bonus: 2 }, { t: 'hyper', pct: 100, price: 100, bonus: 3 }, { t: 'master', pct: 100, price: 1000, bonus: 10, master: true },
  ];
  assert.equal(P.chooseBall(opts, { rare: true, why: 'nouvelle espèce' }).t, 'hyper', 'nouvelle espèce : la moins chère ≥ 80 %');
  assert.equal(P.chooseBall(opts, { rare: true, why: 'chromatique' }).t, 'hyper', 'chromatique : meilleure chance, sans Master Ball');
  assert.equal(P.chooseBall(opts, { legendary: true }).t, 'hyper', 'à chance égale, la moins chère (pas la Master)');
  assert.equal(P.chooseBall(opts, {}).t, 'poke', 'espèce connue : la moins chère par défaut (rien à gagner au Pokédex)');
  P.setOption('catchKnown', 'normal', { persist: false });
  assert.equal(P.chooseBall(opts, {}).t, 'hyper', 'option règle du seuil : Super 67 % < 80 %, l’Hyper Ball (100 %) est la moins chère au-dessus');
  P.setOption('catchKnown', 'free', { persist: false });
  assert.equal(P.chooseBall(opts, {}).t, 'sans', 'option Sans Ball');
  P.setOption('catchKnown', 'cheap', { persist: false });
});

test('capture : règle du seuil de 80 % (meilleure Ball si aucune ne l’atteint)', () => {
  P.setMode('progression', { persist: false });
  P.setOption('catchKnown', 'normal', { persist: false });
  const low = [
    { t: 'sans', pct: 0, price: 0, bonus: 0 }, { t: 'poke', pct: 17, price: 20, bonus: 1 },
    { t: 'super', pct: 33, price: 50, bonus: 2 }, { t: 'hyper', pct: 50, price: 100, bonus: 3 },
  ];
  assert.equal(P.chooseBall(low, {}).t, 'hyper', 'espèce connue avec l’option seuil, tout sous 80 % : la meilleure chance');
  assert.equal(P.chooseBall(low, { rare: true, why: 'nouvelle espèce' }).t, 'hyper', 'nouvelle espèce : idem');
  const high = [
    { t: 'sans', pct: 50, price: 0, bonus: 0 }, { t: 'poke', pct: 67, price: 20, bonus: 1 },
    { t: 'super', pct: 83, price: 50, bonus: 2 }, { t: 'hyper', pct: 100, price: 100, bonus: 3 },
  ];
  assert.equal(P.chooseBall(high, {}).t, 'super', 'option seuil, meilleure ≥ 80 % : on descend à la moins chère qui reste ≥ 80 %');
  assert.equal(P.chooseBall(high, { rare: true, why: 'nouvelle espèce' }).t, 'hyper', 'nouvelle espèce : la meilleure chance par défaut, quitte à payer l’Hyper Ball');
  P.setOption('catchNewPct', 80, { persist: false });
  assert.equal(P.chooseBall(high, { rare: true, why: 'nouvelle espèce' }).t, 'super', 'nouvelle espèce avec un seuil de 80 % : la moins chère au-dessus');
  assert.equal(P.chooseBall(high, { rare: true, why: 'chromatique' }).t, 'hyper', 'chromatique : toujours la meilleure chance');
  P.setOption('catchNewPct', 100, { persist: false });
  assert.equal(P.chooseBall(high, { rare: true, why: 'nouvelle espèce' }).t, 'hyper', 'seuil 100 : toujours la meilleure');
  P.setOption('catchNewPct', 100, { persist: false });
  P.setOption('catchKnown', 'cheap', { persist: false });
});

test('boutique : les soins urgents passent avant les Balls (le soin n’est plus affamé)', () => {
  P.setMode('progression', { persist: false });
  const wish = P.shopWishlist(setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16], gold: 500, inventory: { 'poke-ball': 2 } }));
  assert.equal(wish[0].family, 'heal');
  assert.ok(wish[0].urgent && wish[1].urgent);
});

test('Pokédex : évolutions par niveau suivies sur plusieurs étapes, région respectée', () => {
  P.setMode('pokedex', { persist: false });
  const save = setup({ box: [['m', 11, 8], ['p', 16, 15], ['c', 104, 20], ['k', 25, 9]], team: ['m', 'p', 'c'], pokedex: [10, 11, 16, 25, 104] });
  const t = P.evolutionTargets(save);
  const byDex = Object.fromEntries(t.map((x) => [x.toDex, x]));
  assert.equal(byDex[12].toGo, 2, 'Chrysacier N.8 → Papilusion au N.10');
  assert.equal(byDex[17].toGo, 3, 'Roucool N.15 → Roucoups au N.18');
  assert.equal(byDex[18].level, 36, 'Roucool → Roucarnage : palier le plus haut de la chaîne');
  assert.ok(byDex[105] && !byDex[10115], 'Osselait → Ossatueur de Kanto, pas la forme d’Alola');
  assert.equal(byDex[26].item, 'thunder-stone', 'évolution par Pierre : signalée, pas entraînable');
  assert.equal(t[0].toDex, 12, 'le plus proche du palier passe en premier');
});

test('Pokédex : captures vs évolutions — une zone complète en captures ne retient plus le bot', () => {
  // Chenipan et Pikachu déjà au Pokédex, mais on ne possède plus aucun Pokémon de la lignée Chenipan
  P.setMode('pokedex', { persist: false });
  let save = setup({ box: [['p', 16, 15]], team: ['p'], pokedex: [10, 25, 16], area: 'forest' });
  assert.deepEqual(P.missingSpecies(P.Rt.D.areas.forest, save), [], 'captures : tout est capturé ici');
  assert.notEqual(P.desiredArea(save)?.id, 'forest', 'captures : on quitte la forêt');
  P.setMode('pokedexEvo', { persist: false });
  assert.equal(P.CONFIG.mode, 'pokedex'); assert.equal(P.CONFIG.dexFocus, 'evo');
  assert.deepEqual(P.missingSpecies(P.Rt.D.areas.forest, save), [10, 25], 'évolutions : recapturer Chenipan (Chrysacier/Papilusion) et Pikachu (Raichu, Pierre Foudre)');
  assert.equal(P.desiredArea(save)?.id, 'forest');
  // On possède un Chrysacier : plus besoin de recapturer, il suffit de l'entraîner → on avance
  save = setup({ box: [['p', 16, 15], ['m', 11, 8]], team: ['p', 'm'], pokedex: [10, 11, 25, 16], area: 'forest' });
  assert.deepEqual(P.missingSpecies(P.Rt.D.areas.forest, save), [25], 'Chrysacier possédé : plus besoin de Chenipan ; Pikachu reste à capturer pour Raichu (Pierre Foudre)');
  P.setMode('pokedex', { persist: false });
});

test('évolution par Pierre : utilisée si possédée, achetée en mode Pokédex : évolutions sinon', () => {
  P.setMode('pokedexEvo', { persist: false });
  // Pikachu possédé, Raichu absent du Pokédex
  let save = setup({ box: [['k', 25, 9]], team: ['k'], pokedex: [25], badges: 4, gold: 3000, inventory: { 'poke-ball': 40, 'ultra-ball': 20, potion: 10 } });
  let ev = P.itemEvolutions(save);
  assert.deepEqual(ev.map((x) => [x.mon.dex, x.toDex, x.item, x.owned]), [[25, 26, 'thunder-stone', 0]]);
  assert.ok(P.shopWishlist(save).some((w) => w.key === 'thunder-stone' && w.family === 'stone'), 'Pierre Foudre à acheter');
  // Pas encore 4 badges : pas en vente
  save = setup({ box: [['k', 25, 9]], team: ['k'], pokedex: [25], badges: 1, gold: 3000, inventory: {} });
  assert.ok(!P.shopWishlist(save).some((w) => w.family === 'stone'));
  // Mode Progression : on n'achète pas, mais on utilise celle qu'on a
  P.setMode('progression', { persist: false });
  save = setup({ box: [['k', 25, 9]], team: ['k'], pokedex: [25], badges: 4, gold: 3000, inventory: { 'thunder-stone': 1 } });
  assert.ok(!P.shopWishlist(save).some((w) => w.family === 'stone'));
  assert.equal(P.itemEvolutions(save)[0].owned, 1);
  // Raichu déjà au Pokédex : rien à faire
  save = setup({ box: [['k', 25, 9]], team: ['k'], pokedex: [25, 26], badges: 4, inventory: { 'thunder-stone': 1 } });
  assert.equal(P.itemEvolutions(save).length, 0);
});

test('soins économes : pas de potion contre un sauvage tant que l’équipe de secours tient', () => {
  P.setMode('progression', { persist: false });
  const team = [{ name: 'A', hp: 10, maxHp: 100 }, { name: 'B', hp: 90, maxHp: 100 }];
  const me = team[0], foe = { expDmg: 12 };
  P.mem.fightKind = 'wild'; P.mem.rare = null;
  assert.equal(P.shouldHeal(me, foe, team), false, 'sauvage, B en forme : le Centre soignera gratuitement');
  assert.equal(P.shouldHeal(me, foe, [me, { name: 'B', hp: 5, maxHp: 100 }]), true, 'plus de secours : on soigne');
  P.mem.fightKind = 'gym';
  assert.equal(P.shouldHeal(me, foe, team), true, 'arène : on soigne');
  assert.equal(P.shouldHeal({ name: 'A', hp: 30, maxHp: 100 }, foe, team), false, 'pas en danger : rien');
  P.setOption('healPolicy', 'safe', { persist: false });
  P.mem.fightKind = 'wild';
  assert.equal(P.shouldHeal({ name: 'A', hp: 30, maxHp: 100 }, foe, team), true, 'prudent : PV bas suffisent');
  P.setOption('healPolicy', 'eco', { persist: false });
  // Soin choisi : le plus petit qui permet d'encaisser ~2 coups
  const heals = [{ key: 'potion', amount: 20 }, { key: 'super-potion', amount: 50 }, { key: 'hyper-potion', amount: 120 }];
  assert.equal(P.pickHeal(heals, me, foe).key, 'super-potion', '10 PV, menace 12 → il faut ~20 PV de plus… et ≥ 40 % du manque (36)');
  assert.equal(P.pickHeal(heals, { hp: 70, maxHp: 100 }, { expDmg: 5 }).key, 'potion');
});

test('améliorations : épargne pour la plus rentable au lieu d’acheter les petites', () => {
  const save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16], gold: 0 });
  const cands = [{ key: 'big', label: 'gros', cost: 200, value: 0.05 }, { key: 'small', label: 'petit', cost: 20, value: 0.02 }, { key: 'ok', label: 'presque', cost: 60, value: 0.045 }];
  save.gold = 100 + P.CONFIG.goldReserve; localStorage.setItem('pokedice.save', JSON.stringify(save));
  P.setOption('buy.heal', false, { persist: false }); P.setOption('buy.ball', false, { persist: false }); P.setOption('buy.rareBall', false, { persist: false }); P.setOption('buy.cure', false, { persist: false });
  assert.equal(P.upgradePick(save, cands).key, 'ok', 'presque aussi rentable (90 %) : acceptée');
  assert.equal(P.upgradePick(save, cands.filter((c) => c.key !== 'ok')), null, 'trop peu rentable : on épargne');
  P.setOption('upgradeStrategy', 'greedy', { persist: false });
  assert.equal(P.upgradePick(save, cands.filter((c) => c.key !== 'ok')).key, 'small', 'mode "tout de suite"');
  P.setOption('upgradeStrategy', 'save', { persist: false });
  for (const k of ['heal', 'ball', 'rareBall', 'cure']) P.setOption('buy.' + k, true, { persist: false });
});

test('revente : surplus et soins trop faibles, jamais un objet d’évolution utile', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 999, 60], ['k', 25, 9]], team: ['a'], pokedex: [999, 25], badges: 4, inventory: { potion: 9, 'poke-ball': 60, 'thunder-stone': 1 } });
  const s = Object.fromEntries(P.sellList(save).map((x) => [x.key, x.qty]));
  assert.equal(s.potion, 7, 'Potion (20 PV) pour 600 PV : on en garde 2');
  assert.equal(s['poke-ball'], 40, '60 > 40 → on redescend à 20');
  assert.ok(!s['thunder-stone'], 'Pierre Foudre : Pikachu peut encore évoluer');
});

test('registre : gains, dépenses attribuées et consommation par rencontre', () => {
  const L = P.Ledger;
  localStorage.removeItem('pokedice.save'); // pas de sauvegarde : le registre démarre de zéro
  L.reset();
  L.observe({ gold: 100, inventory: { potion: 5, 'poke-ball': 10 } });
  L.observe({ gold: 130, inventory: { potion: 5, 'poke-ball': 10 } });           // combat gagné
  L.observe({ gold: 100, inventory: { potion: 7, 'poke-ball': 10 } }, { spend: 'heal' }); // achat de 2 Potions
  for (let i = 0; i < 20; i++) { L.encounter(); }
  L.observe({ gold: 100, inventory: { potion: 3, 'poke-ball': 8 } });            // consommé 4 Potions, 2 Balls
  const d = L.data();
  assert.equal(d.income, 30);
  assert.equal(d.spent.heal, 30);
  assert.equal(d.used.heal, 4);
  assert.equal(L.rate('heal'), 4 / 20);
  assert.equal(L.summary().net, 0);
});

test('farm à ₽ : seuls les dresseurs paient, zone terminée ×0,5', () => {
  const save = setup({ box: [['a', 16, 30]], team: ['a'], pokedex: [16] });
  const D = P.Rt.D;
  assert.equal(P.goldPerEncounter(D.areas.route1, save), 0, 'Route 1 : que des sauvages');
  const g = P.goldPerEncounter(D.areas.forest, save);
  assert.ok(Math.abs(g - (2 / 10) * 2 * 6 * 0.5) < 1e-9, 'Forêt : 20 % de dresseurs × 2 Pokémon × N.6 × 0,5');
});

test('boutique : ₽109 et une Hyper Ball urgente → on l’achète au lieu de boucler', async () => {
  P.setMode('pokedex', { persist: false });
  // Forêt : Pikachu (diff. 6) manque → Hyper Ball nécessaire, aucune en stock
  let save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16, 10], badges: 4, gold: 109, inventory: { 'poke-ball': 10, potion: 5 }, area: 'forest' });
  let plan = P.shopPlan(save);
  const ultra = plan.items.find((i) => i.key === 'ultra-ball');
  assert.ok(ultra && ultra.qty === 1 && ultra.urgent, 'urgence : entame la réserve, au moins 1 exemplaire : ' + JSON.stringify(plan));
  assert.ok(plan.spent <= 109);
  // ₽80 : pas d'Hyper Ball possible → la plus forte Ball abordable (Super Ball) à la place
  save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16, 10], badges: 4, gold: 80, inventory: { 'poke-ball': 10, potion: 5 }, area: 'forest' });
  plan = P.shopPlan(save);
  const alt = plan.items.find((i) => i.instead === 'ultra-ball');
  assert.equal(alt?.key, 'great-ball', JSON.stringify(plan));
  // Pas de nouvelle tentative tant que l'or n'a pas bougé
  P.mem.lastChoresGold = -1;
  await P.chores();
  assert.equal(await P.chores(), false, 'même or : pas de nouveau trajet');
});

test('Pokédex : une zone qui piétine (40 rencontres sans nouvelle espèce) est mise de côté', () => {
  P.setMode('pokedex', { persist: false });
  localStorage.removeItem('pokebot.dexStall'); P.mem.dexWatch = null;
  // Pikachu manque en forêt (très rare), Osselait manque dans la grotte
  const save = setup({ box: [['p', 16, 15]], team: ['p'], pokedex: [10, 16], area: 'forest' });
  assert.equal(P.desiredArea(save).id, 'forest');
  for (let i = 0; i <= P.CONFIG.pokedexStallEncounters; i++) P.noteDexProgress(save);
  assert.equal(P.desiredArea(save).id, 'cave', 'forêt mise de côté → grotte');
  localStorage.removeItem('pokebot.dexStall');
});

test('Pokédex : fossiles (poids nul) et fossiles en train de revivre ne retiennent pas le bot dans la zone', () => {
  P.setMode('pokedex', { persist: false });
  localStorage.removeItem('pokebot.dexStall'); P.mem.dexWatch = null;
  const forest = bundle.areas.find((a) => a.id === 'forest');
  const pool = forest.wildPool;
  try {
    // Le jeu ne compte que les espèces de poids > 0 ("Tous capturés") : Raichu à poids nul = fossile de la zone
    forest.wildPool = [...pool, { dex: 26, weight: 0, minLevel: 20, maxLevel: 20 }];
    const save = setup({ box: [['p', 16, 15]], team: ['p'], pokedex: [10, 16, 25], area: 'forest' });
    assert.deepEqual(P.missingSpecies(P.Rt.D.areas.forest, save), [], 'espèce à poids nul ignorée');
    // Pikachu manquant mais déjà en Boîte sous forme de fossile (revivesAt) : compté comme obtenu
    const save2 = setup({ box: [['p', 16, 15], ['f', 25, 20]], team: ['p'], pokedex: [10, 16], area: 'forest' });
    save2.box[1].revivesAt = Date.now() + 3600e3;
    assert.deepEqual(P.missingSpecies(P.Rt.D.areas.forest, save2), [], 'fossile en train de revivre = obtenu');
    assert.notEqual(P.desiredArea(save2).id, 'forest', 'la forêt est complète → on passe à la suite');
    assert.ok(!P.ballPlan(save2).species.some((x) => x.dex === 25), 'pas de Balls achetées pour un fossile');
  } finally { forest.wildPool = pool; }
});

test('Raid : échelles de type du jeu (nos coups super efficaces ×1,3, ceux du boss ×2)', () => {
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7101, 'Eau', 'water', 300); addMon(7102, 'Normal', 'normal', 300);
  const E = P.Rt.E;
  const water = E.speciesAt(7101, 50);
  const fireDef = ['fire'];
  const base = E.avgDamage(water.dice, { attackerTypes: water.types, defTypes: ['normal'], levels: E.allLevels(5) });
  const sup = E.avgDamage(water.dice, { attackerTypes: water.types, defTypes: fireDef, levels: { ...E.allLevels(5), typeScale: { super: 1.3, resisted: 0.5, immune: 0 } } });
  assert.ok(Math.abs(sup / base - 1.3) < 0.1, `super efficace en raid ≈ ×1,3 (mesuré ×${(sup / base).toFixed(2)})`);
  assert.equal(E.scaleEff(0, { super: 2, resisted: 0.7, immune: 0.5 }), 0.5, 'le boss passe une immunité à ×0,5');
  assert.equal(E.scaleEff(2, null), 2, 'hors raid : efficacité inchangée');
  // Défense : contre un boss Plante (×2 sur l'Eau), le Normal survit plus longtemps et inflige plus au total
  addMon(7103, 'BossPlante', 'grass', 900);
  assert.ok(P.raidValue(7102, 50, 7103, 50) > P.raidValue(7101, 50, 7103, 50), 'la défense compte plus que l’attaque en raid');
});

test('Versus : simulation 3 contre 3 et meilleure équipe au N.50', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 999, 50], ['b', 16, 55], ['c', 12, 60], ['d', 10, 12]], team: ['a'], pokedex: [999, 16, 12, 10] });
  const c = (dex) => { const st = P.Rt.E.speciesAt(dex, 50); return { dex, stats: st, hp: st.maxHp, levels: P.Rt.E.allLevels(5) }; };
  assert.ok(P.teamFight([c(999)], [c(16)]) > 0, '600 PV contre 221 PV, mêmes dés : le gros gagne');
  assert.ok(P.teamFight([c(16)], [c(999)]) < 0);
  const best = P.bestVersusTeam(save, [[16, 12, 18]]);
  assert.equal(best.dex.length, 3);
  assert.ok(best.dex.includes(999), 'le plus résistant est retenu : ' + best.dex);
  assert.ok(!best.dex.includes(10), 'N.12 : pas éligible (il faut N.50)');
});

test('modes Versus / Raids : activité par-dessus un mode de repli, verrous respectés', async () => {
  P.setMode('versus', { persist: false });
  assert.equal(P.CONFIG.activity, 'versus');
  assert.equal(P.CONFIG.mode, 'progression', 'repli par défaut');
  setup({ box: [['a', 999, 50], ['b', 16, 20]], team: ['a'], pokedex: [999, 16] });
  assert.equal(await P.activityTick(), false, '1/3 au N.50 : on joue en repli');
  P.setOption('activityFallback', 'pokedex', { persist: false });
  assert.equal(P.CONFIG.mode, 'pokedex');
  assert.equal(P.CONFIG.activity, 'versus');
  P.setOption('activityFallback', 'progression', { persist: false });
  // Raids : la grotte n'est pas terminée → aucun raid légendaire ; terminée → Raichu (raid) proposé
  P.setMode('raid', { persist: false });
  let save = setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  assert.equal(P.nextRaid(save), null);
  save.areaProgress.cave = { cleared: true }; localStorage.setItem('pokedice.save', JSON.stringify(save));
  assert.equal(P.nextRaid(save)?.path, '/raid/cave/26');
  save.pokedex.push(26); localStorage.setItem('pokedice.save', JSON.stringify(save));
  assert.equal(P.nextRaid(save), null, 'déjà capturé : rien à faire');
  P.setMode('progression', { persist: false });
});

test('Versus : grosse Boîte (400 espèces N.50+, 50 équipes adverses) sans figer la page', () => {
  const save = setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  const D = P.Rt.D;
  const types = ['fire', 'water', 'grass', 'electric', 'rock', 'ground', 'psychic', 'dragon', 'ice', 'fighting'];
  for (let i = 0; i < 400; i++) {
    const t = types[i % types.length], t2 = types[(i * 7) % types.length];
    D.species[5000 + i] = { dex: 5000 + i, name: 'X' + i, type1: t, type2: t2 === t ? null : t2, baseHp: 12, maxHp: 250 + (i % 90), speed: i % 10, rerolls: 2, milestones: [],
      dice: [{ type: t, count: 2 + (i % 3) }, { type: t2, count: 1 + (i % 2) }] };
  }
  save.box = Array.from({ length: 400 }, (_, i) => ({ id: 'm' + i, dex: 5000 + i, level: 50 + (i % 40), currentHp: 10 }));
  const foes = Array.from({ length: 50 }, (_, k) => [5000 + k * 7 % 400, 5000 + (k * 13 + 1) % 400, 5000 + (k * 29 + 2) % 400]);
  P.mem.vsBest = null;
  // Meilleure de deux mesures (cache de résultats vidé à chaque fois) : un ralentissement passager de la machine
  // ne fait plus échouer le test, un vrai gel (plusieurs secondes, comme avant la v0.5) si.
  const timeIt = () => { P.mem.vsCache = new Map(); const t0 = performance.now(); const b = P.bestVersusTeam(save, foes); return [performance.now() - t0, b]; };
  const [ms1, best] = timeIt();
  const [ms2] = timeIt();
  const ms = Math.min(ms1, ms2);
  assert.equal(best.dex.length, 3);
  assert.ok(ms < 500, `choix d'équipe en ${ms.toFixed(0)} ms (doit rester < 500 ms ; mesures ${ms1.toFixed(0)} / ${ms2.toFixed(0)} ms)`);
  const t1 = performance.now(); P.bestVersusTeam(save, foes);
  assert.ok(performance.now() - t1 < 5, 'deuxième appel : résultat en cache');
});

const addMon = (dex, name, type, hp, diceType = type, count = 2) => { P.Rt.D.species[dex] = { dex, name, type1: type, type2: null, baseHp: 12, maxHp: hp, speed: 5, rerolls: 1, milestones: [], dice: [{ type: diceType, count }] }; P.Rt.dexName.set(dex, name); };

test('Raid : équipe choisie contre le boss (dégâts infligés avant K.O.)', () => {
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7001, 'Feu', 'fire', 300); addMon(7002, 'Eau', 'water', 300); addMon(7003, 'Plante', 'grass', 300); addMon(7004, 'Boss', 'fire', 900);
  const v = (d) => P.raidValue(d, 50, 7004, 50);
  assert.ok(v(7002) > v(7001), 'Eau > Feu contre un boss Feu');
  assert.ok(v(7001) > v(7003), 'Plante : faible ET se fait toucher en super efficace');
});

test('Versus : l’équipe est taillée contre l’adversaire choisi', () => {
  const save = setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7101, 'Salamèche+', 'fire', 300); addMon(7102, 'Carapuce+', 'water', 300); addMon(7103, 'Bulbi+', 'grass', 300);
  addMon(7104, 'Pikachu+', 'electric', 300); addMon(7105, 'Racaillou+', 'rock', 300); addMon(7106, 'Ptera+', 'flying', 300);
  save.box = [7101, 7102, 7103, 7104, 7105, 7106].map((dex, i) => ({ id: 'v' + i, dex, level: 55, currentHp: 10 }));
  P.mem.vsBest = null;
  const vsFire = P.bestVersusTeam(save, [[7101, 7101, 7101]]);
  assert.ok(vsFire.dex.includes(7102) && vsFire.dex.includes(7105), 'contre du Feu : Eau et Roche ' + vsFire.dex);
  assert.ok(!vsFire.dex.includes(7103), 'pas de Plante contre du Feu');
  const vsWater = P.bestVersusTeam(save, [[7102, 7102, 7102]]);
  assert.ok(vsWater.dex.includes(7103) && vsWater.dex.includes(7104), 'contre de l’Eau : Plante et Électrik ' + vsWater.dex);
  assert.ok(vsFire.score > 0 && vsWater.score > 0);
});

test('Versus : équipe de défense = celle qui repousse le plus d’attaques connues', () => {
  const save = setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7101, 'Salamèche+', 'fire', 300); addMon(7102, 'Carapuce+', 'water', 300); addMon(7103, 'Bulbi+', 'grass', 300);
  addMon(7104, 'Pikachu+', 'electric', 300); addMon(7105, 'Racaillou+', 'rock', 300); addMon(7106, 'Ptera+', 'flying', 300);
  save.box = [7101, 7102, 7103, 7104, 7105, 7106].map((dex, i) => ({ id: 'v' + i, dex, level: 55, currentHp: 10 }));
  const foes = [[7101, 7101, 7101], [7102, 7102, 7102], [7106, 7106, 7106]];
  const def = P.bestDefenseTeam(save, foes);
  assert.equal(def.total, 3);
  assert.equal(def.held, 3, 'repousse Feu, Eau et Vol : ' + def.dex.map((d) => P.Rt.nameOf(d)));
  // l'équipe d'attaque taillée contre le Feu ne tient pas forcément tout le monde en défense
  const atk = P.bestVersusTeam(save, [foes[0]]);
  const c = (d) => { const st = P.Rt.E.speciesAt(d, 50); return { dex: d, stats: st, hp: st.maxHp, levels: P.Rt.E.allLevels(5) }; };
  const heldBy = (team) => foes.filter((f) => -P.teamFight(f.map(c), team.map(c)) > 0).length;
  assert.ok(heldBy(def.dex) >= heldBy(atk.dex));
});

test('combat de dresseur : nouveau Pokémon adverse qui contre le nôtre → on envoie celui qui le gère', () => {
  P.setMode('progression', { persist: false });
  setup({ box: [['f', 7201, 30], ['g', 7202, 30]], team: ['f', 'g'], pokedex: [] });
  addMon(7201, 'Flamme', 'fire', 300); addMon(7202, 'Herbe', 'grass', 300); addMon(7203, 'Vague', 'water', 300);
  P.Rt.D.config.allowVoluntarySwitch = true;
  const save = JSON.parse(localStorage.getItem('pokedice.save'));
  save.box = [{ id: 'f', dex: 7201, level: 30, currentHp: 120 }, { id: 'g', dex: 7202, level: 30, currentHp: 120 }];
  localStorage.setItem('pokedice.save', JSON.stringify(save));
  const foeStats = P.Rt.E.speciesAt(7203, 30), meStats = P.Rt.E.speciesAt(7201, 30);
  const sw = (name) => ({ getAttribute: (k) => (k === 'aria-label' ? `${name}, 120 PV` : null), disabled: false });
  const b = { switchBtns: [sw('Flamme'), sw('Herbe')], ctx: { foe: { name: 'Vague', dex: 7203, hp: foeStats.maxHp, maxHp: foeStats.maxHp, expDmg: 10, stats: foeStats }, me: { name: 'Flamme', hp: 120, maxHp: meStats.maxHp, stats: meStats } } };
  P.mem.fightKind = 'trainer'; P.mem.switchedFor = null;
  const r = P.voluntarySwitch(b);
  assert.equal(r?.name, 'Herbe', 'Feu contre Eau : on envoie la Plante');
  assert.match(r.why, /faible/);
  assert.equal(P.voluntarySwitch(b), null, 'une seule décision par Pokémon adverse');
  P.mem.fightKind = null;
});
/* ── v1.6 : captures, Pension, événements, raids, confort ── */

test('Appâts : achetés selon le stock du mode, jamais si le jeu les a coupés', () => {
  P.setMode('pokedex', { persist: false });
  const save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16, 10, 25], badges: 7, gold: 3000, inventory: { 'poke-ball': 40, 'ultra-ball': 10 } });
  P.Rt.D.items.bait = { key: 'bait', name: 'bait', price: 150, inShop: true, shopBadges: 7, effect: { kind: 'bait', faces: [1, 1, 1, 2, 2, 3] } };
  try {
    const w = P.shopWishlist(save).find((x) => x.key === 'bait');
    assert.equal(w?.qty, P.CONFIG.stock.bait, 'stock d’appâts du mode Pokédex');
    P.Rt.D.config.itemSwitches = { bait: 'off' };
    assert.ok(!P.shopWishlist(save).some((x) => x.key === 'bait'), 'objet coupé par le jeu');
  } finally { delete P.Rt.D.items.bait; delete P.Rt.D.config.itemSwitches; }
});

test('Chance de capture : achetée d’office en mode Pokédex (captures) seulement', () => {
  const save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16], gold: 5000 });
  P.Rt.D.config.general = { access: 'all', luck: [{ chance: 10, cost: 1000 }], offline: [] };
  try {
    P.setMode('progression', { persist: false });
    assert.ok(!P.generalWish(save).some((g) => g.key === 'luck'), 'Progression : réglage buy.luck (coupé)');
    P.setMode('pokedex', { persist: false });
    assert.ok(P.generalWish(save).some((g) => g.key === 'luck'), 'Pokédex : seconde chance quand la Ball rate');
    P.setOption('pokedexLuck', false, { persist: false });
    assert.ok(!P.generalWish(save).some((g) => g.key === 'luck'));
  } finally { P.setOption('pokedexLuck', true, { persist: false }); delete P.Rt.D.config.general; }
});

test('Fossiles : espèce manquante → achat en boutique, ou zone où on le trouve', () => {
  P.setMode('pokedex', { persist: false });
  localStorage.removeItem('pokebot.dexStall');
  // Tout est capturé sauf Raichu (26), qu'on n'obtient que par un fossile
  const save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [10, 16, 25, 104], badges: 4, gold: 3000, inventory: { 'poke-ball': 40, 'ultra-ball': 10 } });
  P.Rt.D.items['old-amber'] = { key: 'old-amber', name: 'old-amber', price: 500, inShop: true, shopBadges: 0, effect: { kind: 'fossil', dex: 26, level: 20, hours: 24 } };
  const cave = P.Rt.D.areas.cave;
  cave.lootPool = [{ itemKey: 'old-amber', weight: 5 }];
  save.areaProgress.cave = { cleared: true };
  try {
    assert.deepEqual(P.fossilTargets(save).map((f) => f.dex), [26]);
    assert.ok(P.shopWishlist(save).some((w) => w.key === 'old-amber' && w.qty === 1 && w.family === 'fossil'), 'fossile en vente : acheté');
    P.Rt.D.items['old-amber'].inShop = false;
    assert.equal(P.desiredArea(save).id, 'cave', 'pas en vente : on va dans la zone qui le donne');
    save.box.push({ id: 'f', dex: 26, level: 20, currentHp: 0, revivesAt: Date.now() + 1e6 });
    assert.equal(P.fossilTargets(save).length, 0, 'fossile déjà en Boîte : plus rien à chercher');
  } finally { delete P.Rt.D.items['old-amber']; delete cave.lootPool; }
});

test('Espèce visée : meilleure zone ouverte, puis l’objectif s’efface une fois capturée', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 16, 20]], team: ['a'], pokedex: [16], area: 'route1' });
  P.setOption('catchTarget', 'Pikachu', { persist: false });
  try {
    assert.equal(P.catchTargetDex(save), 25);
    assert.equal(P.desiredArea(save).id, 'forest', 'Pikachu n’apparaît qu’en forêt');
    save.pokedex.push(25);
    assert.equal(P.catchTargetDex(save), null);
    assert.equal(P.CONFIG.catchTarget, '', 'objectif atteint : option effacée');
  } finally { P.setOption('catchTarget', '', { persist: false }); }
});

test('Pension : compatibilité des groupes Œuf (port du jeu)', () => {
  setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16] });
  P.Rt.D.eggGroups = {
    1: { g: ['Monster', 'Grass'] }, 4: { g: ['Monster', 'Dragon'] }, 10: { g: ['Bug'] }, 132: { g: ['Ditto'], s: 'N' },
    150: { g: ['Undiscovered'], s: 'N', l: 1 }, 29: { g: ['Monster', 'Field'], s: 'F' }, 32: { g: ['Monster', 'Field'], s: 'M' }, 30: { g: ['Monster', 'Field'], s: 'F' },
  };
  assert.ok(P.canBreed(1, 4), 'groupe Monstre commun');
  assert.ok(!P.canBreed(1, 10), 'aucun groupe commun');
  assert.ok(P.canBreed(132, 10), 'Métamorph va avec tout le monde…');
  assert.ok(!P.canBreed(132, 150), '…sauf les légendaires');
  assert.ok(P.canBreed(29, 32), 'Nidoran ♀ + ♂');
  assert.ok(!P.canBreed(29, 30), 'deux espèces femelles seulement');
});

test('Pension : dépose un couple de la Boîte, jamais l’équipe ni les meilleurs niveaux', () => {
  P.setMode('progression', { persist: false });
  P.setOption('centerMaxBox', 1, { persist: false });
  try {
    const save = setup({ box: [['t', 16, 30], ['big', 17, 40], ['b1', 10, 5], ['b2', 11, 6], ['c', 25, 4]], team: ['t'], pokedex: Array.from({ length: 25 }, (_, i) => i + 1) });
    P.Rt.D.eggGroups = { 16: { g: ['Flying'] }, 17: { g: ['Flying'] }, 10: { g: ['Bug'] }, 11: { g: ['Bug'] }, 25: { g: ['Field', 'Fairy'] } };
    P.Rt.D.config.dayCare = { unlockPokedex: 20, slots: 2 };
    assert.equal(P.dayCarePick(save)?.id, 'b1', 'le plus bas niveau qui a un partenaire (Pikachu N.4 n’en a pas)');
    save.dayCare = { residents: [{ inst: { id: 'b1', dex: 10, level: 5 } }], guests: [] };
    save.box = save.box.filter((m) => m.id !== 'b1');
    assert.equal(P.dayCarePick(save)?.id, 'b2', 'le partenaire compatible');
    save.dayCare.residents.push({ inst: { id: 'b2', dex: 11, level: 6 } });
    assert.equal(P.dayCarePick(save), null, 'couple formé : rien à faire');
    save.dayCare.egg = { at: 1 };
    P.mem.dayCareAt = Date.now();
    assert.ok(P.dayCareDue(save), 'un Œuf attend : on y va même si on vient de passer');
  } finally { P.setOption('centerMaxBox', 12, { persist: false }); delete P.Rt.D.config.dayCare; }
});

test('Événements : ouverts selon access / enabled et la zone de déblocage', () => {
  const save = setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16] });
  P.Rt.D.config.events = { wheel: { access: 'all', unlockAreaId: 'route1' }, rebattle: { access: 'off' }, raid: { enabled: true, unlockAreaId: 'forest' } };
  try {
    assert.ok(P.eventOpen('wheel', save), 'route 1 terminée');
    assert.ok(!P.eventOpen('rebattle', save), 'access off');
    assert.ok(!P.eventOpen('raid', save), 'forêt pas terminée');
  } finally { delete P.Rt.D.config.events; }
});

test('Revanche du Conseil 4 : palier courant et équipe prête ou non', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.kanto.leagueAreaId = 'route1';
  P.Rt.D.trainers.e1 = { id: 'e1', name: 'Olga', team: [{ dex: 16, level: 20 }] };
  P.Rt.D.trainers.e2 = { id: 'e2', name: 'Peter', team: [{ dex: 999, level: 90 }] };
  P.Rt.D.config.rebattleLineups = { kanto: { bronze: ['e1'], silver: ['e2'] } };
  P.Rt.D.config.events = { rebattle: { access: 'all', tiers: [{ id: 'bronze', gold: 1, upgradeDelta: 1 }, { id: 'silver', gold: 1.5, upgradeDelta: 2 }] } };
  P.setOption('rebattle', true, { persist: false });
  try {
    assert.equal(P.rebattleState(save).tier.id, 'bronze');
    assert.ok(P.rebattleDue(save), 'Gros N.60 contre Roucool N.20 : prêt');
    save.events = { rebattle: { kanto: { done: 1, step: 0 } } };
    assert.equal(P.rebattleState(save).tier.id, 'silver');
    assert.ok(!P.rebattleDue(save), 'Gros N.90 amélioré : pas prêt');
    save.events.rebattle.kanto.done = 2;
    assert.equal(P.rebattleState(save), null, 'tous les paliers terminés');
  } finally { P.setOption('rebattle', false, { persist: false }); delete P.Rt.D.config.events; delete P.Rt.D.config.rebattleLineups; delete P.Rt.D.regions.kanto.leagueAreaId; }
});

test('Raids : estimation des chances et Pokémon à entraîner', () => {
  const save = setup({ box: [['w', 7002, 30], ['f', 7001, 55], ['g', 7003, 55], ['n', 999, 55]], team: ['f'], pokedex: [999] });
  addMon(7001, 'Feu', 'fire', 300); addMon(7002, 'Eau', 'water', 300); addMon(7003, 'Plante', 'grass', 300); addMon(7004, 'Boss', 'fire', 900);
  P.Rt.D.config.events = { raid: { barHp: 2.2, bars: 3, teamCap: 50, level: 50 } };
  try {
    assert.equal(Math.round(P.raidBossHp(7004, 50)), Math.round(P.Rt.E.speciesAt(7004, 50).maxHp * 6.6));
    assert.equal(P.raidOdds({ myValue: 100, friends: 1, alliesValue: 50 }), 250, 'un ami compte comme ton équipe');
    const t = P.raidTrainee(save, 7004, 50);
    assert.equal(t?.m.id, 'w', 'l’Eau N.30 est le meilleur contre du boss Feu à monter au N.50');
  } finally { delete P.Rt.D.config.events; }
});

test('Planning : plages horaires, y compris à cheval sur minuit', () => {
  const plan = '08:00-23:00=pokedex; 23:00-08:00=farm; n’importe quoi; 10-11=inconnu';
  assert.equal(P.parseSchedule(plan).length, 2, 'lignes invalides ou mode inconnu ignorés');
  const at = (h, m = 0) => P.scheduledMode(plan, new Date(2026, 0, 1, h, m));
  assert.equal(at(9), 'pokedex');
  assert.equal(at(23, 30), 'farm');
  assert.equal(at(3), 'farm');
  assert.equal(P.scheduledMode('', new Date()), null);
});

test('Statistiques : un lancer réussi est compté avec sa Ball', () => {
  setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16] });
  P.Stats.reset();
  P.mem.throwPending = { at: Date.now(), ball: 'Super Ball', isNew: true, shiny: false, legendary: false, name: 'Pikachu' };
  document.body.innerText = 'ui.catch.caught';
  try { P.noteCatchResult(); } finally { document.body.innerText = ''; }
  const d = P.Stats.data();
  assert.deepEqual(d.throws['Super Ball'], { n: 1, ok: 1 });
  assert.equal(d.caught, 1);
  assert.equal(d.newSpecies, 1);
  assert.equal(P.mem.throwPending, null);
});

test('Anti-veille : verrou pris au démarrage, rendu à l’arrêt', async () => {
  const calls = [];
  // Node ≥ 21 a un navigator en lecture seule : on le remplace le temps du test
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { wakeLock: { request: async (t) => { calls.push(t); return { release: async () => calls.push('release'), addEventListener() {} }; } } } });
  try {
    P.setOption('keepAwake', true, { persist: false });
    await P.WakeLock.on();
    assert.deepEqual(calls, ['screen']);
    await P.WakeLock.on();
    assert.equal(calls.length, 1, 'un seul verrou à la fois');
    await P.WakeLock.off();
    assert.deepEqual(calls, ['screen', 'release']);
    P.setOption('keepAwake', false, { persist: false });
    await P.WakeLock.on();
    assert.equal(calls.length, 2, 'option coupée : aucun verrou');
  } finally { if (before) Object.defineProperty(globalThis, 'navigator', before); else delete globalThis.navigator; P.setOption('keepAwake', true, { persist: false }); }
});

/* ── v1.7 : XP, porteur et élèves ── */
const multiExp = () => Object.assign(P.Rt.D.config, { multiExpShare: 0.3, multiExpGapBonus: 0.05, multiExpMaxShare: 1, xpShareMode: 'fighter', maxLevel: 100 });

test('XP : part Multi Exp du jeu (30 % + 5 % par niveau d’écart, plafonnée)', () => {
  const save = setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  multiExp();
  assert.equal(P.xpShare(100, 50, save), 1, '50 niveaux d’écart : 100 %');
  assert.ok(Math.abs(P.xpShare(30, 28, save) - 0.4) < 1e-9, '2 niveaux : 40 %');
  assert.ok(Math.abs(P.xpShare(20, 40, save) - 0.3) < 1e-9, 'plus haut que le combattant : 30 %');
  save.settings = { multiExp: false };
  assert.equal(P.xpShare(100, 50, save), 0, 'Multi Exp coupé par le joueur');
  P.Rt.D.config.xpShareMode = 'team';
  assert.equal(P.xpShare(100, 50, save), 1, 'mode « team » : tout le monde');
});

test('XP : le porteur au niveau max mène, ses élèves prennent tout', () => {
  const save = setup({ box: [['c', 999, 100], ['t1', 16, 40], ['t2', 10, 40]], team: ['c', 't1', 't2'], pokedex: [999, 16, 10] });
  multiExp();
  const [c, t1, t2] = P.teamMons(save);
  P.mem.xpTrainees = [];
  assert.equal(P.usefulXp(c, [c, t1, t2], save), 2, 'porteur N.100 : 0 pour lui, 100 % pour chaque élève');
  assert.ok(Math.abs(P.usefulXp(t1, [c, t1, t2], save) - 1.3) < 1e-9, 'un élève qui mène : 100 % + 30 % pour l’autre élève');
});

test('XP : élèves choisis par priorité (évolution manquante, Versus, potentiel)', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['c', 999, 100], ['cat', 10, 5], ['pid', 16, 45], ['big', 999, 20], ['max', 17, 100]], team: ['c'], pokedex: [999, 10, 16, 17] });
  multiExp();
  const picks = P.pickTrainees(save, 3, new Set(['c']));
  assert.equal(picks[0].m.id, 'cat', 'Chenipan N.5 → Chrysacier (absent du Pokédex) au N.7 : priorité 1');
  assert.equal(picks[1].m.id, 'pid', 'Versus : le plus haut sous le N.50');
  assert.ok(!picks.some((x) => x.m.id === 'max'), 'jamais un Pokémon au niveau max');
  assert.ok(!picks.some((x) => x.m.id === 'c'), 'jamais le porteur');
});

test('Farm XP : la zone qui rapporte le plus d’XP que le porteur tient sans risque', () => {
  P.setMode('farm', { persist: false });
  const save = setup({ box: [['c', 999, 60]], team: ['c'], pokedex: [999], area: 'route1' });
  save.areaProgress.forest = { cleared: true };
  save.areaProgress.cave = {};
  const { forest, route1, cave } = P.Rt.D.areas;
  assert.ok(P.xpPerEncounter(forest, save) > P.xpPerEncounter(route1, save), 'niveaux plus hauts en forêt');
  const xpCave = P.xpPerEncounter(cave, save);
  save.areaProgress.cave = { cleared: true };
  assert.ok(Math.abs(P.xpPerEncounter(cave, save) - xpCave / 2) < 1e-9, 'zone terminée : XP divisée par 2');
  P.setOption('farmGoal', 'xpAuto', { persist: false });
  try {
    P.mem.xpArea = null;
    const best = P.bestXpArea(save);
    assert.ok(best && best.id !== 'route1', `zone choisie : ${best?.id}`);
    assert.equal(P.desiredArea(save).id, best.id);
  } finally { P.setOption('farmGoal', 'xp', { persist: false }); P.setMode('progression', { persist: false }); }
});

test('Centre : un porteur si la zone est facile, deux sinon, le reste en élèves', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['c', 999, 100], ['c2', 18, 60], ['t1', 16, 30], ['t2', 10, 5]], team: ['c', 'c2', 't1'], pokedex: [999, 18, 16, 10] });
  multiExp();
  const mons = [...P.teamMons(save), ...P.boxMons(save)];
  const area = P.Rt.D.areas.route1;
  const easy = P.xpTeamPlan(save, mons, P.areaThreats(area).map((x) => ({ ...x, weight: 1 })), area, 3);
  assert.deepEqual(easy.carriers.map((m) => m.id), ['c'], 'Gros N.100 contre Roucool : un seul porteur');
  assert.equal(easy.trainees.length, 2);
  assert.ok(!easy.trainees.some((t) => t.m.id === 'c'), 'le porteur n’est pas un élève');
  P.setOption('carrierSafeScore', 99, { persist: false });
  try {
    const hard = P.xpTeamPlan(save, mons, P.areaThreats(area).map((x) => ({ ...x, weight: 1 })), area, 3);
    assert.equal(hard.carriers.length, 2, 'zone jugée dangereuse : deux porteurs');
    assert.equal(hard.trainees.length, 1);
  } finally { P.setOption('carrierSafeScore', 1.6, { persist: false }); }
});

test('Combos : gain réel du combo payé, y compris quand un combo plus fort le cachait', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 7301, 30]], team: ['a'], pokedex: [7301] });
  P.Rt.D.species[7301] = { dex: 7301, name: 'Quatre', type1: 'normal', type2: null, baseHp: 12, maxHp: 300, speed: 5, rerolls: 0, milestones: [], dice: [{ type: 'base', count: 4 }] };
  // Paire 2 → 8 (dépasse la Double paire à 5) ; Double paire déjà au maximum
  P.Rt.D.comboUp = { pair: [{ level: 1, bonus: 2, cost: 0 }, { level: 2, bonus: 8, cost: 100 }], two_pair: [{ level: 1, bonus: 5, cost: 0 }], three_kind: [{ level: 1, bonus: 6, cost: 0 }, { level: 2, bonus: 9, cost: 100 }] };
  P.Rt.D.config.comboPayoutMode = 'highestDamage';
  const mons = [{ m: P.teamMons(save)[0], w: 1 }];
  const g = P.comboGains(save, mons, 2000);
  assert.equal(g.two_pair, 0, 'pas de niveau suivant : aucun gain');
  // Paire améliorée (8) : +6 sur une Paire seule, +3 quand la Double paire (5) la cachait, +2 au-dessus d'un Brelan (6) ou d'un Carré
  // 4 dés base : P(paire seule) = 720/1296, P(double paire) = 90/1296, P(brelan) = 120/1296, P(carré) = 6/1296
  const exact = (720 * 6 + 90 * 3 + 120 * 2 + 6 * 2) / 1296; // ≈ 3,73 ; l'ancien calcul ne voyait que 720×6/1296 ≈ 3,33
  assert.ok(Math.abs(g.pair - exact) < 0.25, `gain de la Paire ≈ ${exact.toFixed(2)} par lancer (mesuré ${g.pair.toFixed(2)})`);
  assert.ok(g.three_kind > 0);
  const cands = P.upgradeCandidates(save).filter((c) => c.kind === 'combo').map((c) => c.key);
  assert.ok(cands.includes('pair') && !cands.includes('two_pair'));
});

test('Combos : calcul rapide même avec une grosse équipe et des relances', () => {
  const save = setup({ box: [['a', 7302, 50]], team: ['a'], pokedex: [7302] });
  P.Rt.D.species[7302] = { dex: 7302, name: 'Six', type1: 'normal', type2: null, baseHp: 12, maxHp: 300, speed: 5, rerolls: 3, milestones: [], dice: [{ type: 'normal', count: 6 }] };
  P.Rt.D.comboUp = Object.fromEntries(['pair', 'two_pair', 'three_kind', 'small_straight', 'full_house', 'four_kind', 'full_straight', 'five_kind'].map((k, i) => [k, [{ level: 1, bonus: 2 + 3 * i, cost: 0 }, { level: 2, bonus: 4 + 4 * i, cost: 200 }]]));
  const mon = P.teamMons(save)[0];
  const t0 = performance.now();
  const g = P.comboGains(save, Array.from({ length: 9 }, () => ({ m: mon, w: 1 })));
  assert.ok(performance.now() - t0 < 300, `9 Pokémon à 6 dés : ${(performance.now() - t0).toFixed(0)} ms`);
  assert.ok(Object.values(g).filter((x) => x > 0).length >= 5, 'la plupart des combos ont un gain mesuré');
});

test('Capture : l’espèce lue sur l’écran de capture décide « nouvelle espèce », et le nom des Balls est reconnu', () => {
  P.setMode('pokedex', { persist: false });
  setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16] });
  P.Rt.i18n.set('ui.catch.wornOut', '{who} {name} est épuisé !');
  P.Rt.i18n.set('ui.catch.theWild', 'Le');
  P.Rt.frNameToDex.set('PIKACHU', 25); P.Rt.frNameToDex.set('ROUCOOL', 16);
  try {
    document.body.innerText = ['Combat', 'Le Pikachu est épuisé !', 'LANCER POUR CAPTURER'].join('\n');
    assert.equal(P.captureParam('ui.catch.wornOut', 'name'), 'PIKACHU', 'paramètre {name} lu, {who} ignoré');
    assert.equal(P.catchScreenDex(), 25, 'Pikachu reconnu, même avec « Le » devant');
    document.body.innerText = 'Le Roucool est épuisé !';
    assert.equal(P.catchScreenDex(), 16);
    // Nom des Balls : nom des données du jeu si la traduction ne correspond pas
    P.Rt.D.items['great-ball'].name = 'Great Ball'; P.Rt.D.items['master-ball'].name = 'Master Ball';
    assert.equal(P.ballItemOf('GREAT BALL, 3 RESTANTES : 67 % DE CHANCE')?.key, 'great-ball');
    assert.equal(P.ballItemOf('MASTER BALL, 1 RESTANTES : 100 % DE CHANCE')?.key, 'master-ball', 'la Master Ball est reconnue (jamais lancée hors légendaire)');
    assert.equal(P.ballItemOf('SANS BALL : 33 % DE CHANCE'), null);
  } finally { document.body.innerText = ''; P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); }
});

/**
 * Faux écran « Modifier l'équipe de raid », fidèle au jeu (e2e du bundle) :
 * candidats = li > button[aria-pressed] avec <b>nom</b><small>N.x</small> et, s'il est choisi, <span class="light-scope">place</span> ;
 * « Enregistrer » désactivé tant que l'équipe est vide ; « Effacer » vide tout ; 3 places au plus.
 */
function fakeRaidTeamDialog(cands, initial = []) {
  let team = [...initial];
  const el = (props) => Object.assign({ getClientRects: () => [1], getAttribute() { return null; }, dataset: {}, querySelector: () => null, querySelectorAll: () => [] }, props);
  const mkCand = (c) => {
    const b = el({ innerText: c.name }), small = el({ innerText: `N.${c.level}` });
    const btnEl = el({
      get innerText() { const i = team.indexOf(c.id); return `${c.name}\nN.${c.level}${i >= 0 ? '\n' + (i + 1) : ''}`; },
      getAttribute: (k) => (k === 'aria-pressed' ? String(team.includes(c.id)) : null),
      querySelector: (sel) => (sel === 'b' ? b : sel === 'small' ? small : null),
      // Comme dans le jeu : le sprite contient un <span> vide (dernier enfant) AVANT le numéro de place
      querySelectorAll: (sel) => (sel === 'span' ? [el({ className: 'relative', innerText: '' }), el({ className: '', innerText: '' }), ...(team.includes(c.id) ? [el({ className: 'light-scope grid h-7 w-7', innerText: String(team.indexOf(c.id) + 1) })] : [])] : []),
      click: () => { team = team.includes(c.id) ? team.filter((x) => x !== c.id) : team.length >= 3 ? team : [...team, c.id]; },
    });
    return btnEl;
  };
  const candBtns = cands.map(mkCand);
  const save = el({ innerText: 'ENREGISTRER', get disabled() { return team.length === 0; }, click() { save.saved = [...team]; } });
  const clear = el({ innerText: 'EFFACER', clears: 0, get disabled() { return team.length === 0; }, click() { clear.clears++; team = []; } });
  const dialogEl = el({ innerText: 'Ton équipe de raid', querySelectorAll: (sel) => (sel === 'li button[aria-pressed]' ? candBtns : sel.startsWith('button') ? [...candBtns, clear, save] : []) });
  return { dialogEl, save, clear, get team() { return team; } };
}

test('Raid : l’équipe est refaite dans le bon ordre, même quand « Enregistrer » se désactive (équipe vide)', async () => {
  P.setMode('progression', { persist: false });
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7401, 'Feu', 'fire', 300); addMon(7402, 'Eau', 'water', 300); addMon(7403, 'Plante', 'grass', 300); addMon(7404, 'Roche', 'rock', 300); addMon(7405, 'BossFeu', 'fire', 900);
  P.Rt.i18n.set('ui.raid.teamSave', 'Enregistrer'); P.Rt.i18n.set('ui.versus.clear', 'Effacer');
  for (const [n, d] of [['FEU', 7401], ['EAU', 7402], ['PLANTE', 7403], ['ROCHE', 7404]]) P.Rt.frNameToDex.set(n, d);
  P.Rt.D.config.events = { raid: { teamCap: 50, level: 50, barHp: 2.2, bars: 3 } };
  const cands = [{ id: 'f', name: 'Feu', level: 50 }, { id: 'p', name: 'Plante', level: 50 }, { id: 'e', name: 'Eau', level: 50 }, { id: 'r', name: 'Roche', level: 50 }];
  const ui = fakeRaidTeamDialog(cands, ['p', 'f']); // équipe actuelle : Plante, Feu (mauvaise contre un boss Feu)
  const before = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '[role=dialog]' ? [ui.dialogEl] : []);
  try {
    const r = { dex: 7405, bossLevel: 50, idle: 0 };
    for (let i = 0; i < 12 && !r.teamDone; i++) assert.ok(await P.ensureRaidTeam(r), `étape ${i} : une action à chaque passage`);
    assert.ok(r.teamDone, 'équipe terminée (plus de boucle sur « Modifier »)');
    assert.ok(ui.save.saved, 'Enregistrer cliqué');
    const v = { f: 7401, p: 7403, e: 7402, r: 7404 };
    const expected = Object.keys(v).sort((x, y) => P.raidValue(v[y], 50, 7405, 50) - P.raidValue(v[x], 50, 7405, 50)).slice(0, 3);
    assert.deepEqual(ui.save.saved, expected, 'les 3 meilleurs contre le boss, le meilleur en tête');
    assert.ok(!ui.save.saved.includes('p'), 'pas de Plante contre un boss Feu');
    assert.equal(ui.clear.clears, 1, 'l’équipe de départ est effacée une seule fois (plus de boucle choisir / effacer)');
    assert.equal(ui.save.saved.length, 3);
  } finally { document.querySelectorAll = before; P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); delete P.Rt.D.config.events; }
});

test('Pokédex : captures — on ne fait évoluer que vers une espèce absente du Pokédex et introuvable en sauvage', () => {
  // Chenipan → Chrysacier → Papilusion ; Roucool → Roucoups ; Osselait → Ossatueur
  const save = setup({ box: [['c', 999, 100], ['cat', 10, 5], ['pid', 16, 15], ['cub', 104, 20]], team: ['c'], pokedex: [999, 10, 11, 16, 104] });
  multiExp();
  P.setMode('pokedex', { persist: false });
  save.areaProgress.forest = {};
  // Chrysacier déjà recensé : faire monter Chenipan ne sert à rien (même si Papilusion manque)
  assert.ok(!P.dexUsefulEvolutions(save).some((t) => t.mon.id === 'cat'), 'évolution directe déjà au Pokédex');
  // Roucoups manque et n'apparaît nulle part en sauvage : on fait évoluer Roucool
  assert.ok(P.dexUsefulEvolutions(save).some((t) => t.mon.id === 'pid' && t.toDex === 17));
  // Ossatueur manque mais apparaît souvent en sauvage dans une zone ouverte : on le capture plutôt
  const cave = P.Rt.D.areas.cave; const pool = cave.wildPool;
  cave.wildPool = [...pool, { dex: 105, weight: 50, minLevel: 6, maxLevel: 10 }];
  save.areaProgress.cave = {};
  try {
    assert.ok(P.wildShare(105, save) >= 0.4);
    assert.ok(!P.dexWorthEvolving(105, save), 'Ossatueur se capture');
    const picks = P.pickTrainees(save, 2, new Set(['c']));
    assert.deepEqual(picks.map((t) => t.m.id), ['pid'], 'seul Roucool est un élève utile au Pokédex');
    const plan = P.xpTeamPlan(save, [...P.teamMons(save), ...P.boxMons(save)], [], P.Rt.D.areas.route1, 3);
    assert.equal(plan.carriers.length + plan.trainees.length, 3, 'les places restantes vont aux meilleurs Pokémon');
  } finally { cave.wildPool = pool; P.setMode('progression', { persist: false }); }
});

test('Raid : équipe déjà bonne et dans l’ordre → rien n’est effacé', async () => {
  P.setMode('progression', { persist: false });
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7401, 'Feu', 'fire', 300); addMon(7402, 'Eau', 'water', 300); addMon(7403, 'Plante', 'grass', 300); addMon(7404, 'Roche', 'rock', 300); addMon(7405, 'BossFeu', 'fire', 900);
  P.Rt.i18n.set('ui.raid.teamSave', 'Enregistrer'); P.Rt.i18n.set('ui.versus.clear', 'Effacer');
  for (const [n, d] of [['FEU', 7401], ['EAU', 7402], ['PLANTE', 7403], ['ROCHE', 7404]]) P.Rt.frNameToDex.set(n, d);
  P.Rt.D.config.events = { raid: { teamCap: 50, level: 50, barHp: 2.2, bars: 3 } };
  const v = { f: 7401, p: 7403, e: 7402, r: 7404 };
  const best = Object.keys(v).sort((x, y) => P.raidValue(v[y], 50, 7405, 50) - P.raidValue(v[x], 50, 7405, 50)).slice(0, 3);
  const cands = [{ id: 'f', name: 'Feu', level: 50 }, { id: 'p', name: 'Plante', level: 50 }, { id: 'e', name: 'Eau', level: 50 }, { id: 'r', name: 'Roche', level: 50 }];
  const ui = fakeRaidTeamDialog(cands, best);
  const before = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '[role=dialog]' ? [ui.dialogEl] : []);
  try {
    const r = { dex: 7405, bossLevel: 50, idle: 0 };
    for (let i = 0; i < 6 && !r.teamDone; i++) await P.ensureRaidTeam(r);
    assert.equal(ui.clear.clears, 0, 'rien à effacer');
    assert.deepEqual(ui.save.saved, best);
  } finally { document.querySelectorAll = before; P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); delete P.Rt.D.config.events; }
});

test('Raids : raid choisi, raid du jour d’abord, en boucle sans plafond d’essais', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  save.areaProgress.cave = { cleared: true };
  P.Rt.D.config.events = { raid: { enabled: true } };
  localStorage.removeItem('pokebot.activity');
  try {
    assert.deepEqual(P.openRaids(save).map((r) => r.key), ['daily', 'cave/26'], 'raid du jour + Raichu (grotte terminée)');
    assert.equal(P.nextRaid(save).key, 'daily');
    P.setOption('raidTarget', 'cave/26', { persist: false });
    assert.equal(P.nextRaid(save).key, 'cave/26', 'raid choisi dans le panneau');
    save.events = { raidsDone: ['cave:26'] };
    assert.ok(!P.openRaids(save).some((r) => r.key === 'cave/26'), 'raid noté fait par le jeu (events.raidsDone)');
    assert.equal(P.nextRaid(save).key, 'daily', 'raid choisi indisponible : retour au choix automatique');
    delete save.events;
    P.setOption('raidTarget', '', { persist: false });
    localStorage.setItem('pokebot.activity', JSON.stringify({ raidTries: { day: new Date().toISOString().slice(0, 10), n: { daily: 99, 'cave/26': 99 } } }));
    assert.equal(P.nextRaid(save), null, 'plafond d’essais atteint');
    P.setOption('raidLoop', true, { persist: false });
    assert.equal(P.nextRaid(save).key, 'daily', 'en boucle : on continue');
  } finally { P.setOption('raidLoop', false, { persist: false }); P.setOption('raidTarget', '', { persist: false }); localStorage.removeItem('pokebot.activity'); delete P.Rt.D.config.events; }
});

/** Petit faux DOM : éléments cliquables visibles, recherche par sélecteur simulée. */
const fakeEl = (props = {}) => Object.assign({ getClientRects: () => [1], getAttribute(k) { return this.attrs?.[k] ?? null; }, dataset: {}, querySelector: () => null, querySelectorAll: () => [], innerText: '', textContent: '', clicks: 0, click() { this.clicks++; } }, props);
function withScreen({ sections = [], buttons = [], radios = [], body = '' }, fn) {
  const before = document.querySelectorAll, beforeText = document.body.innerText;
  document.querySelectorAll = (sel) => (sel === 'section[aria-label]' ? sections : sel === 'button, a[role=button]' || sel === 'button' ? buttons : sel === 'button, [role=radio]' ? [...buttons, ...radios] : []);
  document.body.innerText = body;
  return Promise.resolve(fn()).finally(() => { document.querySelectorAll = before; document.body.innerText = beforeText; });
}

test('Raid : « Raid perdu » avec le combat encore affiché derrière → Réessayer (plus de blocage)', async () => {
  P.setMode('raid', { persist: false });
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  for (const [k, v] of [['ui.raid.heading', 'Raid : {name}'], ['ui.battle.heading', 'Combat : {a} contre {b}'], ['ui.raid.again', 'Réessayer'], ['ui.raid.result.lostTitle', 'Raid perdu'], ['ui.raid.back', 'Retour aux raids'], ['ui.common.back', 'Retour']]) P.Rt.i18n.set(k, v);
  const again = fakeEl({ innerText: 'Réessayer' }), back = fakeEl({ innerText: 'Retour', attrs: { 'aria-label': 'Retour aux raids' } });
  const section = fakeEl({ attrs: { 'aria-label': 'Raid : Mewtwo' } });
  P.mem.raid = { key: 'cave/26', dex: 26, idle: 0 };
  localStorage.removeItem('pokebot.activity');
  try {
    await withScreen({ sections: [section], buttons: [back, again], body: 'Raid : Mewtwo\nRaid perdu\nMewtwo était trop fort cette fois.\nRetour\nRéessayer' }, async () => {
      assert.ok(P.readBattle()?.raid, 'la section du combat est bien encore là');
      assert.ok(await P.playRaidPage());
    });
    assert.equal(again.clicks, 1, 'Réessayer cliqué');
    assert.equal(back.clicks, 0);
  } finally { P.Rt.i18n.clear(); P.mem.raid = null; localStorage.removeItem('pokebot.activity'); P.setMode('progression', { persist: false }); }
});

test('Raid : le boss se capture avec la meilleure chance, Master Ball comprise, même déjà au Pokédex', async () => {
  P.setMode('raid', { persist: false });
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999, 26] });
  for (const [k, v] of [['ui.raid.heading', 'Raid : {name}'], ['ui.catch.ballLabel', '{label}{left} : {pct} % de chance{useless}'], ['ui.catch.roll', 'LANCER POUR CAPTURER'], ['ui.raid.log.won', '{boss} est épuisé ! Lance une Ball !']]) P.Rt.i18n.set(k, v);
  P.Rt.D.items['poke-ball'].name = 'Poké Ball'; P.Rt.D.items['ultra-ball'].name = 'Hyper Ball'; P.Rt.D.items['master-ball'].name = 'Master Ball';
  P.Rt.frNameToDex.set('RAICHU', 26);
  const radio = (label) => fakeEl({ attrs: { 'aria-label': label, role: 'radio', 'aria-checked': 'false' } });
  const poke = radio('Poké Ball, 9 restantes : 17 % de chance'), hyper = radio('Hyper Ball, 3 restantes : 50 % de chance'), master = radio('Master Ball, 1 restantes : 100 % de chance');
  const roll = fakeEl({ innerText: 'LANCER POUR CAPTURER' });
  P.mem.rare = null; P.mem.fightKind = null; P.mem.raid = { key: 'cave/26', dex: 26 };
  const section = fakeEl({ attrs: { 'aria-label': 'Raid : Raichu' } });
  try {
    await withScreen({ sections: [section], buttons: [roll], radios: [poke, hyper, master], body: 'Raichu est épuisé ! Lance une Ball !' }, () => P.playCatch());
    assert.equal(master.clicks, 1, 'Master Ball choisie (rien d’autre n’atteint 100 %)');
    assert.equal(poke.clicks, 0, 'jamais la Poké Ball sur un boss de raid');
    assert.equal(roll.clicks, 1);
    assert.equal(P.mem.rare?.why, 'raid');
  } finally { P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); P.mem.raid = null; P.mem.rare = null; P.mem.throwPending = null; P.setMode('progression', { persist: false }); }
});

test('Capture : toutes les options de Ball sont reconnues, pas seulement les « inutiles » (paramètre vide)', async () => {
  P.setMode('pokedex', { persist: false });
  setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16] });
  for (const [k, v] of [['ui.catch.ballLabel', '{label}{left} : {pct} % de chance{useless}'], ['ui.catch.roll', 'LANCER POUR CAPTURER'], ['ui.catch.wornOut', '{who} {name} est épuisé !']]) P.Rt.i18n.set(k, v);
  const re = P.Rt.re('ui.catch.ballLabel');
  assert.ok(re.test('SANS BALL : 33 % DE CHANCE'), 'Sans Ball (ni {left} ni {useless})');
  assert.ok(re.test('HYPER BALL, 3 RESTANTES : 67 % DE CHANCE'), 'option normale ({useless} vide) — non reconnue avant la v1.7.4');
  assert.ok(re.test('HYPER BALL, 3 RESTANTES : 100 % DE CHANCE, INUTILE'), 'option inutile');
  // Écran complet : nouvelle espèce difficile → la meilleure Ball (et non la sélection par défaut « Sans Ball »)
  P.Rt.D.items['poke-ball'].name = 'Poké Ball'; P.Rt.D.items['ultra-ball'].name = 'Hyper Ball';
  P.Rt.frNameToDex.set('PIKACHU', 25);
  const radio = (label) => fakeEl({ attrs: { 'aria-label': label, role: 'radio', 'aria-checked': 'false' } });
  const none = radio('Sans Ball : 33 % de chance'), poke = radio('Poké Ball, 9 restantes : 50 % de chance'), hyper = radio('Hyper Ball, 2 restantes : 83 % de chance');
  const roll = fakeEl({ innerText: 'LANCER POUR CAPTURER' });
  P.mem.rare = null; P.mem.fightKind = 'wild'; P.mem.raid = null;
  try {
    await withScreen({ buttons: [roll], radios: [none, poke, hyper], body: 'Le Pikachu est épuisé !' }, () => P.playCatch());
    assert.equal(hyper.clicks, 1, 'Hyper Ball cliquée');
    assert.equal(roll.clicks, 1);
    assert.equal(P.mem.rare?.why, 'nouvelle espèce');
  } finally { P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); P.mem.rare = null; P.mem.fightKind = null; P.mem.throwPending = null; P.setMode('progression', { persist: false }); }
});

/** Combat simulé pour battleItems : un Sac qui note les ouvertures, des dés base. */
function fakeFight({ faces, meHp, meMax = 100, foeHp, foeExp = 60, rerolls = 0, raid = false }) {
  const bag = fakeEl({ innerText: 'SAC' });
  const dice = faces.map((v, i) => ({ el: fakeEl(), type: 'base', face: { kind: 'number', value: v }, label: `Dé, ${v}#${i}`, selected: false }));
  const ctx = {
    attackerTypes: ['normal'], defTypes: ['normal'], levels: { comboLevels: {}, dieLevels: {} },
    foe: { name: 'Foe', dex: 16, hp: foeHp, maxHp: 200, expDmg: foeExp, stats: null },
    me: { name: 'Moi', dex: 999, hp: meHp, maxHp: meMax, expDmg: 10, stats: null },
  };
  return { b: { raid, dice, ctx, shownDmg: NaN, rerollsLeft: rerolls, bagBtn: bag, rerollBtn: null }, bag };
}

test('Soins : pas de potion quand l’attaque tue déjà, même sans dégâts affichés', async () => {
  P.setMode('progression', { persist: false });
  setup({ box: [['a', 999, 30]], team: ['a'], pokedex: [999], inventory: { potion: 5 } });
  P.mem.itemTurn = null; P.mem.cureTurn = null; P.mem.fightKind = 'trainer';
  // 6+6+6 = 18 (+ brelan) ≥ 10 PV adverses ; nous à 5 PV face à une menace de 60 : avant la v1.7.5, potion
  const kill = fakeFight({ faces: [6, 6, 6], meHp: 5, foeHp: 10 });
  assert.equal(await P.battleItems(kill.b), false);
  assert.equal(kill.bag.clicks, 0, 'aucune potion : l’attaque finit l’adversaire');
  P.mem.fightKind = null;
});

test('Soins : en raid, aucun objet (copies du raid) sauf réglage', async () => {
  setup({ box: [['a', 999, 30]], team: ['a'], pokedex: [999], inventory: { potion: 5 } });
  P.mem.itemTurn = null; P.mem.fightKind = 'raid';
  const f = fakeFight({ faces: [1, 2, 3], meHp: 5, foeHp: 900, raid: true });
  assert.equal(await P.battleItems(f.b), false);
  assert.equal(f.bag.clicks, 0, 'pas de potion en raid');
  P.mem.fightKind = null;
});

test('Capture : l’écran « Presque ! Lancer un Appât ? » est traité (plus de blocage)', async () => {
  P.setMode('pokedex', { persist: false });
  setup({ box: [['a', 16, 10]], team: ['a'], pokedex: [16] });
  for (const [k, v] of [['ui.catch.baitThrow', 'Lancer l’Appât ×{n}'], ['ui.catch.baitKeep', 'Le garder'], ['ui.catch.baitAsk', 'Presque ! Lancer un Appât pour attirer {name} ?']]) P.Rt.i18n.set(k, v);
  P.Rt.frNameToDex.set('PIKACHU', 25);
  const keep = fakeEl({ innerText: 'Le garder' }), thr = fakeEl({ innerText: 'Lancer l’Appât ×2' });
  P.mem.rare = null; P.mem.fightKind = 'wild'; P.mem.raid = null;
  try {
    await withScreen({ buttons: [keep, thr], body: 'Presque ! Lancer un Appât pour attirer Pikachu ?' }, async () => {
      assert.ok(P.Rt.re('ui.catch.baitThrow').test('LANCER L’APPÂT ×2'));
      assert.ok(await P.playCatch());
    });
    assert.equal(thr.clicks, 1, 'nouvelle espèce (Pikachu lu à l’écran) : l’appât est lancé');
    assert.equal(keep.clicks, 0);
  } finally { P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); P.mem.rare = null; P.mem.fightKind = null; P.setMode('progression', { persist: false }); }
});

test('Revente : jamais le meilleur soin en vente, même devenu faible face à une équipe N.100', () => {
  P.setMode('progression', { persist: false });
  // Mur N.100 : 900 PV → l'Hyper Potion (120) rend moins de 20 % des PV, mais c'est le meilleur soin en vente
  const save = setup({ box: [['a', 999, 100]], team: ['a'], pokedex: [999], badges: 4, gold: 5000, inventory: { 'hyper-potion': 6, potion: 9, 'poke-ball': 30, 'ultra-ball': 5 } });
  addMon(7501, 'Mur', 'normal', 900); save.box[0].dex = 7501;
  const sells = P.sellList(save).map((x) => x.key);
  assert.ok(!sells.includes('hyper-potion'), 'l’Hyper Potion n’est pas revendue : ' + sells);
  assert.ok(sells.includes('potion'), 'la Potion (20 PV, plus faible que le palier acheté) part bien');
  const buys = P.shopWishlist(save).map((x) => x.key);
  assert.ok(!sells.some((k) => buys.includes(k)), 'rien n’est à la fois vendu et acheté');
});

test('Centre : les candidats ne dépendent pas de qui est dans l’équipe (plus de boucle Leveinard / Grolem)', () => {
  P.setMode('pokedex', { persist: false });
  P.setOption('centerMaxBox', 2, { persist: false });
  try {
    // 5 Pokémon : deux N.100, un N.69 ; l'équipe change, la liste des candidats non
    const mk = (team) => setup({ box: [['dra', 999, 100], ['lev', 999, 100], ['gro', 16, 69], ['x', 10, 20], ['y', 16, 15]], team, pokedex: [999, 16, 10] });
    const ids = (save) => P.centerCandidates(save).map((m) => m.id).sort().join(',');
    assert.equal(ids(mk(['dra', 'lev', 'x'])), ids(mk(['dra', 'gro', 'x'])), 'mêmes candidats, Grolem dans l’équipe ou en Boîte');
  } finally { P.setOption('centerMaxBox', 12, { persist: false }); P.setMode('progression', { persist: false }); }
});

test('Pokédex : évolutions — pierres : capture de la base, farm ₽ si l’or manque, or réservé', () => {
  P.setMode('pokedexEvo', { persist: false });
  localStorage.removeItem('pokebot.dexStall');
  // Pikachu (25) → Raichu (26) avec une Pierre Foudre (₽200, 4 badges). Gros N.60 pour tenir les zones.
  const save = setup({ box: [['g', 999, 60], ['pk', 25, 20]], team: ['g'], pokedex: [999, 25, 10, 11, 12, 16, 17, 18, 104, 105], badges: 4, gold: 120, area: 'route1' });
  save.areaProgress.forest = { cleared: true };
  P.Rt.D.areas.forest.encounterWeights = { wild: 4, trainer: 4 };
  P.mem.goldArea = null;
  try {
    assert.deepEqual(P.stoneNeeds(save).map((n) => [n.item, n.inShop, n.toDex[0]]), [['thunder-stone', true, 26]]);
    assert.equal(P.stoneGoldShortfall(save), 200 - (120 - P.CONFIG.goldReserve), 'il manque ₽ pour la Pierre Foudre');
    assert.equal(P.desiredArea(save).id, 'forest', 'farm ₽ dans la zone qui rapporte le plus (dresseurs)');
    assert.ok(P.consumablesReserve(save) >= 200 + P.CONFIG.goldReserve, 'la pierre est réservée en entier : les améliorations attendent');
    save.gold = 1000;
    assert.equal(P.stoneGoldShortfall(save), 0, 'assez d’or : plus besoin de farm');
    // Sans Pikachu : la forêt reste utile pour capturer la base (évolution par pierre manquante)
    save.box = save.box.filter((m) => m.id !== 'pk'); save.pokedex = save.pokedex.filter((d) => d !== 25);
    assert.ok(P.missingSpecies(P.Rt.D.areas.forest, save, 'evo').includes(25), 'Pikachu à capturer pour Raichu (pierre)');
  } finally { delete P.Rt.D.areas.forest.encounterWeights; P.mem.goldArea = null; P.setMode('progression', { persist: false }); }
});

/* ── v1.9 : Revanche (équipe pour tout le palier), régions, partenaire ── */
test('Revanche : l’équipe couvre tout le palier (chaque Pokémon adverse a une réponse)', () => {
  P.setMode('progression', { persist: false });
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7601, 'Eau', 'water', 300); addMon(7602, 'Plante', 'grass', 300); addMon(7603, 'Feu', 'fire', 300); addMon(7604, 'Normal1', 'normal', 300); addMon(7605, 'Normal2', 'normal', 300);
  addMon(7611, 'FeuAdv', 'fire', 300); addMon(7612, 'EauAdv', 'water', 300); addMon(7613, 'PlanteAdv', 'grass', 300);
  const mon = (dex) => { const st = P.Rt.E.speciesAt(dex, 50); return { id: 'm' + dex, dex, name: String(dex), level: 50, stats: st, maxHp: st.maxHp, levels: P.Rt.E.allLevels(3) }; };
  const cands = [7601, 7602, 7603, 7604, 7605].map(mon);
  const threats = [7611, 7612, 7613].map((dex) => ({ dex, level: 50, levels: P.Rt.E.allLevels(3) }));
  const best = P.bestTeamVs(cands, threats);
  assert.equal(best.team.length, 3);
  assert.deepEqual(best.team.map((m) => m.dex).sort(), [7601, 7602, 7603], 'Eau + Plante + Feu : une réponse à chaque type adverse');
  assert.ok(best.worst > 0);
});

test('Régions : nouvelle région ouverte après la Ligue, changement selon le mode', () => {
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999, 10, 16, 25, 104], area: 'route1' });
  P.Rt.D.regions.kanto = { ...P.Rt.D.regions.kanto, leagueAreaId: 'cave', nextRegion: 'johto', starters: [1, 4, 7], orderIndex: 0 };
  P.Rt.D.regions.johto = { id: 'johto', name: 'Johto', orderIndex: 1, dexRange: [152, 251], starters: [152, 155, 158], enabled: true };
  for (const [dex, name, hp] of [[152, 'Germignon', 200], [155, 'Héricendre', 300], [158, 'Kaiminus', 250]]) addMon(dex, name, 'normal', hp);
  P.setOption('rebattle', false, { persist: false });
  try {
    assert.equal(P.newRegionOpen(save), null, 'Ligue pas encore battue');
    save.areaProgress.cave = { cleared: true };
    assert.equal(P.newRegionOpen(save)?.id, 'johto');
    P.setMode('progression', { persist: false });
    assert.equal(P.regionSwitchDue(save)?.id, 'johto', 'Progression : on y va');
    P.setMode('pokedex', { persist: false });
    localStorage.removeItem('pokebot.dexStall');
    save.areaProgress.forest = {};
    save.pokedex = save.pokedex.filter((d) => d !== 25);
    assert.equal(P.regionSwitchDue(save), null, 'Pokédex : captures — Pikachu manque encore en forêt : on reste');
    save.pokedex.push(25);
    assert.equal(P.regionSwitchDue(save)?.id, 'johto', 'Pokédex : captures — plus rien à capturer : on change de région');
    P.setMode('pokedexEvo', { persist: false });
    assert.equal(P.regionSwitchDue(save), null, 'Pokédex : évolutions — pas de changement automatique');
  } finally { P.setMode('progression', { persist: false }); }
});

test('Régions : partenaire choisi dans les réglages, sinon le meilleur potentiel', () => {
  setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.johto = { id: 'johto', name: 'Johto', orderIndex: 1, dexRange: [152, 251], starters: [152, 155, 158], enabled: true };
  for (const [dex, name, hp] of [[152, 'Germignon', 200], [155, 'Héricendre', 300], [158, 'Kaiminus', 250]]) addMon(dex, name, 'normal', hp);
  P.setOption('starterPick.johto', '', { persist: false });
  assert.equal(P.starterFor('johto'), 155, 'automatique : le meilleur potentiel (Héricendre, 300 PV)');
  P.setOption('starterPick.johto', 158, { persist: false });
  assert.equal(P.starterFor('johto'), 158, 'réglage : Kaiminus');
  P.setOption('starterPick.johto', '', { persist: false });
});

test('Régions : écran du partenaire — la bonne Poké Ball, Choisir, puis C’est parti', async () => {
  setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.johto = { id: 'johto', name: 'Johto', orderIndex: 1, dexRange: [152, 251], starters: [152, 155, 158], enabled: true };
  for (const [dex, name] of [[152, 'Germignon'], [155, 'Héricendre'], [158, 'Kaiminus']]) { addMon(dex, name, 'normal', 250); P.Rt.frNameToDex.set(name.toUpperCase(), dex); }
  for (const [k, v] of [['ui.partner.label', 'Choisis ton partenaire à {region}'], ['ui.partner.ball', 'Poké Ball {n} sur 3'], ['ui.partner.out', '{name}, sorti de sa Poké Ball'], ['ui.partner.yes', 'Choisir {name}'], ['ui.partner.no', 'Pas celui-ci'], ['ui.partner.go', 'C’est parti !']]) P.Rt.i18n.set(k, v);
  P.setOption('starterPick.johto', 158, { persist: false });
  const balls = [1, 2, 3].map((n) => fakeEl({ attrs: { 'aria-label': `Poké Ball ${n} sur 3` } }));
  const dlg = fakeEl({ attrs: { 'aria-label': 'Choisis ton partenaire à Johto', role: 'dialog' } });
  dlg.querySelectorAll = (sel) => (sel === 'button[aria-label]' ? balls : sel.startsWith('button') ? buttons : []);
  let buttons = [...balls];
  dlg.querySelector = () => null;
  const before = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '[role=dialog]' ? [dlg] : sel.startsWith('button') ? buttons : []);
  P.mem.regionGo = P.Rt.D.regions.johto;
  try {
    assert.ok(await P.playPartner(dlg));
    assert.equal(balls[2].clicks, 1, 'Poké Ball 3 = Kaiminus (3e starter)');
    const yes = fakeEl({ innerText: 'Choisir Kaiminus' });
    buttons = [yes]; document.body.innerText = 'Tu veux choisir Kaiminus ?\nChoisir Kaiminus';
    assert.ok(await P.playPartner(dlg));
    assert.equal(yes.clicks, 1, 'Kaiminus confirmé');
    const go = fakeEl({ innerText: 'C’est parti !' });
    buttons = [go];
    assert.ok(await P.playPartner(dlg));
    assert.equal(go.clicks, 1);
    assert.equal(P.mem.regionGo, null, 'changement de région terminé');
  } finally { document.querySelectorAll = before; document.body.innerText = ''; P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); P.setOption('starterPick.johto', '', { persist: false }); P.mem.regionGo = null; }
});

test('Mode Revanche du Conseil 4 : équipe préparée au Centre, puis la carte de l’accueil', () => {
  const save = setup({ box: [['a', 999, 60], ['b', 16, 30]], team: ['b'], pokedex: [999, 16] });
  P.Rt.D.regions.kanto.leagueAreaId = 'route1';
  P.Rt.D.trainers.e1 = { id: 'e1', name: 'Olga', team: [{ dex: 16, level: 20 }] };
  P.Rt.D.config.rebattleLineups = { kanto: { bronze: ['e1'] } };
  P.Rt.D.config.events = { rebattle: { access: 'all', tiers: [{ id: 'bronze', gold: 1, upgradeDelta: 1 }] } };
  P.setMode('rebattle', { persist: false });
  P.mem.rbPlan = null; P.mem.errand = null; P.mem.actLog = null;
  localStorage.removeItem('pokebot.activity');
  try {
    assert.equal(P.CONFIG.activity, 'rebattle', 'mode activité, comme Versus et Raids');
    const plan = P.rebattlePlan(save);
    assert.ok(plan?.team.some((m) => m.id === 'a'), 'le Gros N.60 est dans l’équipe de revanche');
    assert.equal(P.rebattleActivity(save), false, 'équipe pas encore composée : on attend le Centre');
    save.team = plan.team.map((m) => m.id);
    P.mem.rbPlan = null;
    const card = fakeEl({ attrs: { 'aria-label': 'Revanche du Conseil 4, palier Bronze : ensuite, Olga. Combat 1 sur 5. Ouvrir' } });
    P.Rt.i18n.set('ui.events.rebattle.label', '{name}, palier {tier} : ensuite, {foe}. {sub}. Ouvrir');
    const before = document.querySelectorAll;
    document.querySelectorAll = (sel) => (sel === 'button[aria-label]' ? [card] : []);
    try { assert.ok(P.rebattleActivity(save)); } finally { document.querySelectorAll = before; }
    assert.equal(card.clicks, 1, 'ouverte depuis la carte de l’accueil');
    assert.equal(P.mem.errand, 'rebattle');
  } finally { P.mem.errand = null; P.Rt.i18n.clear(); delete P.Rt.D.config.events; delete P.Rt.D.config.rebattleLineups; delete P.Rt.D.regions.kanto.leagueAreaId; P.setMode('progression', { persist: false }); }
});

/* ── v1.10.1 : simulation de la série de revanche ── */
test('Revanche : lineup comme le jeu — un seul Rival (celui du starter), améliorations adverses', () => {
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [4, 999] }); // starter = Salamèche (1re espèce)
  P.Rt.D.regions.kanto.leagueAreaId = 'route1';
  P.Rt.D.areas.route1.enemyUpgradeLevel = 4;
  P.Rt.D.trainers = {
    e1: { id: 'e1', name: 'Olga', team: [{ dex: 16, level: 20 }] },
    r1: { id: 'r1', name: 'Rival A', rivalOf: 1, team: [{ dex: 10, level: 20 }] },
    r4: { id: 'r4', name: 'Rival B', rivalOf: 4, team: [{ dex: 25, level: 20 }] },
    c1: { id: 'c1', name: 'Peter', upgradeLevel: 7, team: [{ dex: 999, level: 30 }] },
  };
  P.Rt.D.config.rebattleLineups = { kanto: { bronze: ['e1', 'r1', 'r4', 'c1'] } };
  P.Rt.D.config.events = { rebattle: { access: 'all', tiers: [{ id: 'bronze', gold: 1, upgradeDelta: 2 }] } };
  try {
    const rb = P.rebattleState(save);
    assert.deepEqual(rb.trainers.map((t) => t.id), ['e1', 'r4', 'c1'], 'seul le Rival qui correspond au starter Salamèche');
    assert.equal(P.rebattleUpgrade(rb, rb.trainers[0]), 6, 'zone de la Ligue (4) + palier (2)');
    assert.equal(P.rebattleUpgrade(rb, rb.trainers[2]), 7, 'niveau propre du dresseur, sans bonus de palier');
    P.Rt.D.config.events.rebattle.tiers[0].upgradeDelta = 'max';
    assert.equal(P.rebattleUpgrade(rb, rb.trainers[0]), 10, '« max » = 10');
  } finally { delete P.Rt.D.config.events; delete P.Rt.D.config.rebattleLineups; delete P.Rt.D.regions.kanto.leagueAreaId; delete P.Rt.D.areas.route1.enemyUpgradeLevel; }
});

test('Revanche : la simulation garde les PV d’un combat à l’autre et choisit l’équipe qui gagne la série', () => {
  setup({ box: [['a', 999, 50]], team: ['a'], pokedex: [999] });
  addMon(7701, 'Fragile', 'normal', 120); addMon(7702, 'Mur', 'normal', 900); addMon(7703, 'Moyen', 'normal', 300);
  addMon(7711, 'Adv', 'normal', 200);
  const mon = (dex, id) => { const st = P.Rt.E.speciesAt(dex, 50); return { id, dex, name: P.Rt.nameOf(dex), level: 50, stats: st, maxHp: st.maxHp, levels: P.Rt.E.allLevels(3) }; };
  const lv = P.Rt.E.allLevels(3);
  const one = [{ dex: 7711, level: 50, levels: lv }];
  const many = Array.from({ length: 8 }, () => ({ dex: 7711, level: 50, levels: lv, trainer: 'X' }));
  const fragile = [mon(7701, 'f')];
  assert.ok(P.simulateGauntlet(fragile, one).beaten <= 1);
  const solo = P.simulateGauntlet([mon(7703, 'm')], one);
  const series = P.simulateGauntlet([mon(7703, 'm')], many);
  assert.ok(solo.wins, 'Moyen bat un adversaire seul');
  assert.ok(!series.wins && series.beaten < 8, `mais pas huit d'affilée sans Centre (${series.beaten}/8)`);
  assert.ok(series.stuckOn, 'la simulation dit sur qui ça bloque');
  const best = P.bestGauntletTeam([mon(7701, 'f'), mon(7702, 'w'), mon(7703, 'm')], many);
  assert.ok(best.team.some((m) => m.id === 'w'), 'le Mur fait partie de l’équipe');
  assert.ok(best.beaten >= series.beaten);
});

test('Régions : une Revanche « prête » ne retient plus le départ en Progression, seulement une série en cours', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.kanto = { ...P.Rt.D.regions.kanto, leagueAreaId: 'cave', nextRegion: 'johto', starters: [1, 4, 7], orderIndex: 0 };
  P.Rt.D.regions.johto = { id: 'johto', name: 'Johto', orderIndex: 1, dexRange: [152, 251], starters: [152, 155, 158], enabled: true };
  save.areaProgress.cave = { cleared: true };
  P.Rt.D.trainers.e1 = { id: 'e1', name: 'Olga', team: [{ dex: 16, level: 20 }] };
  P.Rt.D.config.rebattleLineups = { kanto: { bronze: ['e1'] } };
  P.Rt.D.config.events = { rebattle: { access: 'all', tiers: [{ id: 'bronze', gold: 1, upgradeDelta: 1 }] } };
  P.mem.regionFail = false; P.mem.rbPlan = null;
  try {
    assert.equal(P.regionSwitchStatus(save).due, true, 'revanche gagnable mais pas commencée : on part quand même');
    save.events = { rebattle: { kanto: { done: 0, step: 1 } } };
    const st = P.regionSwitchStatus(save);
    assert.equal(st.due, false);
    assert.match(st.why, /Revanche du Conseil 4 est en cours/);
    delete save.events;
    P.setOption('autoRegion', false, { persist: false });
    assert.match(P.regionSwitchStatus(save).why, /désactivé/, 'la raison est expliquée');
  } finally { P.setOption('autoRegion', true, { persist: false }); delete P.Rt.D.config.events; delete P.Rt.D.config.rebattleLineups; }
});

test('Raids : ouverts comme le jeu — espèce déjà vue mais boss pas battu sur place, zone portail', () => {
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999, 26] });
  const cave = P.Rt.D.areas.cave;
  P.Rt.D.config.events = { raid: { access: 'all' } };
  try {
    save.areaProgress.cave = { cleared: true, bossesDefeated: [] };
    assert.equal(P.raidStatus(save, cave, { dex: 26 }), 'open', 'Raichu déjà au Pokédex, mais pas battu dans la grotte : ouvert (comme le jeu)');
    P.setOption('raidOnlyMissing', true, { persist: false });
    assert.equal(P.legendaryRaids(save).length, 0, 'écarté en automatique (réglage espèces manquantes)');
    assert.equal(P.legendaryRaids(save, { all: true }).length, 1, 'mais listé dans le panneau, et faisable si on le choisit');
    P.setOption('raidTarget', 'cave/26', { persist: false });
    assert.equal(P.nextRaid(save)?.key, 'cave/26', 'choisi explicitement : il est fait');
    P.setOption('raidTarget', '', { persist: false });
    save.areaProgress.cave.bossesDefeated = [26];
    assert.equal(P.raidStatus(save, cave, { dex: 26 }), 'done', 'battu sur place et au Pokédex : fait');
    const portal = { id: 'p1', mode: 'portal', legendaryBoss: [{ dex: 26, raid: true }] };
    save.areaProgress.p1 = { cleared: false, portal: { won: true } };
    assert.equal(P.raidStatus(save, portal, { dex: 26 }), 'open', 'zone portail gagnée : ouvert même sans « zone terminée »');
  } finally { P.setOption('raidTarget', '', { persist: false }); delete P.Rt.D.config.events; }
});

test('Régions : la fenêtre du partenaire est trouvée même par-dessus la liste des Zones', async () => {
  setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.johto = { id: 'johto', name: 'Johto', orderIndex: 1, dexRange: [152, 251], starters: [152, 155, 158], enabled: true };
  for (const [dex, name] of [[152, 'Germignon'], [155, 'Héricendre'], [158, 'Kaiminus']]) { addMon(dex, name, 'normal', 250); P.Rt.frNameToDex.set(name.toUpperCase(), dex); }
  for (const [k, v] of [['ui.partner.label', 'Choisis ton partenaire à {region}'], ['ui.partner.ball', 'Poké Ball {n} sur 3']]) P.Rt.i18n.set(k, v);
  P.setOption('starterPick.johto', 155, { persist: false });
  const balls = [1, 2, 3].map((n) => fakeEl({ attrs: { 'aria-label': `Poké Ball ${n} sur 3` } }));
  const zones = fakeEl({ attrs: { role: 'dialog', 'aria-label': 'Zones' } });
  const partner = fakeEl({ attrs: { role: 'dialog', 'aria-label': 'Choisis ton partenaire à Johto' } });
  partner.querySelectorAll = (sel) => (sel === 'button[aria-label]' ? balls : sel.startsWith('button') ? balls : []);
  const before = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '[role=dialog]' ? [zones, partner] : sel.startsWith('button') ? balls : []);
  P.mem.regionGo = P.Rt.D.regions.johto;
  try {
    assert.equal(P.partnerDialog(), partner, 'la fenêtre du partenaire, pas celle des Zones');
    await P.playPartner(P.partnerDialog());
    assert.equal(balls[1].clicks, 1, 'Poké Ball 2 = Héricendre');
  } finally { document.querySelectorAll = before; P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); P.setOption('starterPick.johto', '', { persist: false }); P.mem.regionGo = null; }
});

test('Régions : écran « Tu veux choisir Germignon ? » (DOM réel du joueur) — Choisir ou Pas celui-ci selon le réglage', async () => {
  setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.johto = { id: 'johto', name: 'Johto', orderIndex: 1, dexRange: [152, 251], starters: [152, 155, 158], enabled: true };
  for (const [dex, name] of [[152, 'Germignon'], [155, 'Héricendre'], [158, 'Kaiminus']]) { addMon(dex, name, 'normal', 250); P.Rt.frNameToDex.set(name.toUpperCase(), dex); }
  for (const [k, v] of [['ui.partner.label', 'Choisis ton partenaire à {region}'], ['ui.partner.ball', 'Poké Ball {n} sur 3'], ['ui.partner.out', '{name}, sorti de sa Poké Ball'], ['ui.partner.yes', 'Choisir {name}'], ['ui.partner.no', 'Pas celui-ci'], ['ui.partner.go', 'C’est parti !']]) P.Rt.i18n.set(k, v);
  // Écran collé par le joueur : Poké Ball 1 ouverte (Germignon), boutons Pas celui-ci / Choisir Germignon
  const balls = [fakeEl({ attrs: { 'aria-label': 'Germignon, sorti de sa Poké Ball' } }), fakeEl({ attrs: { 'aria-label': 'Poké Ball 2 sur 3' } }), fakeEl({ attrs: { 'aria-label': 'Poké Ball 3 sur 3' } })];
  const leave = fakeEl({ attrs: { 'aria-label': 'Pas maintenant' }, innerText: '✕' });
  const no = fakeEl({ innerText: 'Pas celui-ci' }), yes = fakeEl({ innerText: 'Choisir Germignon' });
  const all = [...balls, leave, no, yes];
  const dlg = fakeEl({ attrs: { role: 'dialog', 'aria-label': 'Choisis ton partenaire à Johto' } });
  dlg.querySelectorAll = (sel) => (sel === 'button[aria-label]' ? [...balls, leave] : sel.startsWith('button') ? all : []);
  const before = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '[role=dialog]' ? [dlg] : sel.startsWith('button') ? all : []);
  document.body.innerText = ['Tu veux choisir Germignon ?', 'Germignon', 'Plante', 'Pas celui-ci', 'Choisir Germignon'].join('\n');
  P.mem.regionGo = null; // fenêtre ouverte à la main : la région se lit dans le titre
  try {
    P.setOption('starterPick.johto', 152, { persist: false });
    await P.playPartner(P.partnerDialog());
    assert.equal(yes.clicks, 1, 'Germignon voulu : Choisir Germignon');
    P.setOption('starterPick.johto', 158, { persist: false });
    await P.playPartner(P.partnerDialog());
    assert.equal(no.clicks, 1, 'Kaiminus voulu : Pas celui-ci');
    assert.equal(yes.clicks, 1);
  } finally { document.querySelectorAll = before; document.body.innerText = ''; P.Rt.i18n.clear(); P.Rt.frNameToDex.clear(); P.setOption('starterPick.johto', '', { persist: false }); }
});

test('Régions : depuis Johto, les raids et événements débloqués à Kanto restent visibles (sauvegarde rangée par région)', () => {
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.areas.cave.regionId = 'kanto'; P.Rt.D.areas.forest.regionId = 'kanto';
  P.Rt.D.areas.j29 = { id: 'j29', name: 'Route 29', regionId: 'johto', orderIndex: 100, wildPool: [] };
  P.Rt.D.areaList.push(P.Rt.D.areas.j29);
  P.Rt.D.config.events = { raid: { access: 'all', unlockAreaId: 'forest' }, wheel: { access: 'all', unlockAreaId: 'forest' } };
  // On joue à Johto : la sauvegarde de Kanto est rangée dans parked.kanto
  save.region = 'johto'; save.currentAreaId = 'j29'; save.areaProgress = { j29: {} }; save.pokedex = [152];
  save.parked = { kanto: { areaProgress: { forest: { cleared: true }, cave: { cleared: true, bossesDefeated: [] } }, pokedex: [999, 10, 16] } };
  localStorage.removeItem('pokebot.activity');
  try {
    assert.ok(P.eventOpen('raid', save), 'raid du jour débloqué par une zone de Kanto');
    assert.ok(P.eventOpen('wheel', save), 'roue aussi');
    assert.equal(P.raidStatus(save, P.Rt.D.areas.cave, { dex: 26 }), 'open', 'Raichu (grotte de Kanto) ouvert, vu depuis Johto');
    const raids = P.openRaids(save).map((r) => r.key);
    assert.ok(raids.includes('daily') && raids.includes('cave/26'), 'raid du jour + raid légendaire de Kanto : ' + raids);
    save.parked.kanto.pokedex.push(26);
    assert.ok(P.legendaryRaids(save, { all: true })[0].caught, 'Pokédex de Kanto (pas celui de Johto) pour savoir si l’espèce est déjà vue');
  } finally { delete P.Rt.D.config.events; P.Rt.D.areaList.pop(); delete P.Rt.D.areas.j29; }
});

test('Régions : à Johto, la Progression reste à Johto (zones de Kanto sans regionId = Kanto, comme le jeu)', () => {
  P.setMode('progression', { persist: false });
  const save = setup({ box: [['a', 999, 20]], team: ['a'], pokedex: [999] });
  // Zones de Kanto du test : sans regionId (le jeu les range à Kanto par défaut)
  for (const id of ['route1', 'forest', 'cave']) delete P.Rt.D.areas[id].regionId;
  P.Rt.D.areas.j29 = { id: 'j29', name: 'Route 29', regionId: 'johto', orderIndex: 100, minLevel: 2, maxLevel: 5, wildPool: [] };
  P.Rt.D.areas.j30 = { id: 'j30', name: 'Routes 30 & 31', regionId: 'johto', orderIndex: 101, minLevel: 3, maxLevel: 8, wildPool: [] };
  P.Rt.D.areaList.push(P.Rt.D.areas.j29, P.Rt.D.areas.j30);
  try {
    save.region = 'johto'; save.areaProgress = { j29: { cleared: true } };
    save.currentAreaId = 'route1'; // même si la zone courante enregistrée est restée à Kanto
    assert.equal(P.regionId ? P.regionId(save) : 'johto', 'johto');
    const next = P.desiredArea(save);
    assert.notEqual(next?.id, 'route1', 'jamais la Route 1 de Kanto');
    save.currentAreaId = 'j29';
    assert.equal(P.desiredArea(save)?.id, 'j30', 'Route 29 finie → Routes 30 & 31');
  } finally { P.Rt.D.areaList.splice(-2, 2); delete P.Rt.D.areas.j29; delete P.Rt.D.areas.j30; }
});

test('Régions : retour dans une région déjà jouée — Revanche à Kanto depuis Johto, puis retour à Johto en Progression', async () => {
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.kanto = { ...P.Rt.D.regions.kanto, id: 'kanto', name: 'Kanto', leagueAreaId: 'cave', nextRegion: 'johto', starters: [1, 4, 7], orderIndex: 0 };
  P.Rt.D.regions.johto = { id: 'johto', name: 'Johto', orderIndex: 1, dexRange: [152, 251], starters: [152, 155, 158], enabled: true, leagueAreaId: 'jleague' };
  P.Rt.D.areas.j29 = { id: 'j29', name: 'Route 29', regionId: 'johto', orderIndex: 100, wildPool: [] };
  P.Rt.D.areaList.push(P.Rt.D.areas.j29);
  P.Rt.D.trainers.e1 = { id: 'e1', name: 'Olga', team: [{ dex: 16, level: 20 }] };
  P.Rt.D.config.rebattleLineups = { kanto: { bronze: ['e1'] } };
  P.Rt.D.config.events = { rebattle: { access: 'all', tiers: [{ id: 'bronze', gold: 1, upgradeDelta: 1 }] } };
  // À Johto ; Kanto (Ligue gagnée, revanche bronze à faire) est rangée dans parked.kanto
  save.region = 'johto'; save.currentAreaId = 'j29'; save.areaProgress = { j29: {} }; save.pokedex = [152];
  save.parked = { kanto: { areaProgress: { cave: { cleared: true }, route1: { cleared: true }, forest: { cleared: true } }, pokedex: [999, 10, 16, 25, 104] } };
  P.mem.regionGo = null; P.mem.regionFail = false;
  try {
    assert.ok(P.rebattleState(save, 'kanto'), 'revanche de Kanto disponible (vue depuis Johto)');
    P.setMode('rebattle', { persist: false });
    assert.equal(P.playedRegionTarget(save)?.id, 'kanto', 'mode Revanche : on retourne à Kanto');
    // Le bot clique la carte « Kanto : passer à cette région et voir ses zones »
    P.Rt.i18n.set('ui.home.regionGo', '{region} : passer à cette région et voir ses zones');
    const card = fakeEl({ attrs: { 'aria-label': 'Kanto : passer à cette région et voir ses zones' } });
    const before = document.querySelectorAll;
    document.querySelectorAll = (sel) => (sel === 'button[aria-label]' ? [card] : []);
    try { assert.ok(await P.regionTick(save)); } finally { document.querySelectorAll = before; }
    assert.equal(card.clicks, 1);
    // Arrivé à Kanto, en Progression : la Ligue de Kanto est gagnée, Johto non → retour à Johto
    P.mem.regionGo = null;
    save.region = 'kanto'; save.currentAreaId = 'cave'; save.areaProgress = save.parked.kanto.areaProgress; save.pokedex = save.parked.kanto.pokedex;
    save.parked = { johto: { areaProgress: { j29: {} }, pokedex: [152] } };
    P.setMode('progression', { persist: false });
    assert.equal(P.playedRegionTarget(save)?.id, 'johto', 'Progression : retour à la région pas finie');
  } finally { P.mem.regionGo = null; P.Rt.i18n.clear(); P.Rt.D.areaList.pop(); delete P.Rt.D.areas.j29; delete P.Rt.D.config.events; delete P.Rt.D.config.rebattleLineups; P.setMode('progression', { persist: false }); }
});

test('Boss : un légendaire de raid (Mewtwo à la Caverne Azurée) n’est pas un boss de zone en attente', () => {
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  const cave = P.Rt.D.areas.cave; // legendaryBoss: Raichu, raid: true
  save.areaProgress.cave = { cleared: true, roundsDone: 9, gymsDefeated: [], bossesDefeated: [] };
  assert.equal(P.bossTeam(cave).length, 0, 'pas d’équipe de boss : c’est un raid');
  assert.equal(P.bossPending ? P.bossPending(cave, save) : false, false, 'rien en attente');
});

test('Mode Revanche : on tente quand la simulation bat la plupart des adversaires', () => {
  const save = setup({ box: [['a', 999, 60]], team: ['a'], pokedex: [999] });
  P.Rt.D.regions.kanto.leagueAreaId = 'route1';
  addMon(7801, 'Coriace', 'normal', 5000);
  P.Rt.D.trainers = { e1: { id: 'e1', name: 'Olga', team: [{ dex: 16, level: 20 }, { dex: 16, level: 20 }] }, e2: { id: 'e2', name: 'Peter', team: [{ dex: 16, level: 20 }, { dex: 7801, level: 99 }] } };
  P.Rt.D.config.rebattleLineups = { kanto: { bronze: ['e1', 'e2'] } };
  P.Rt.D.config.events = { rebattle: { access: 'all', tiers: [{ id: 'bronze', gold: 1, upgradeDelta: 1 }] } };
  P.setMode('rebattle', { persist: false });
  P.mem.rbPlan = null;
  try {
    let plan = P.rebattlePlan(save);
    assert.ok(!plan.ready, 'série pas gagnée en simulation');
    assert.equal(plan.beaten, 3, '3 adversaires sur 4 battus');
    P.setOption('rebattleTryPct', 0.7, { persist: false }); P.mem.rbPlan = null;
    assert.ok(P.rebattlePlan(save).worthTrying, '75 % ≥ 70 % : on tente');
    P.setOption('rebattleTryPct', 0.8, { persist: false }); P.mem.rbPlan = null;
    assert.ok(!P.rebattlePlan(save).worthTrying, '75 % < 80 % : on s’entraîne');
  } finally { P.setOption('rebattleTryPct', 0.8, { persist: false }); delete P.Rt.D.config.events; delete P.Rt.D.config.rebattleLineups; delete P.Rt.D.regions.kanto.leagueAreaId; P.setMode('progression', { persist: false }); }
});

test('Bandeau « pourquoi » : raison affichée quand l’activité ne se joue pas, effacée quand elle reprend', async () => {
  const save = setup({ box: [['a', 999, 20]], team: ['a'], pokedex: [999] });
  P.setMode('versus', { persist: false });
  try {
    P.mem.why = null;
    await P.activityTick();
    assert.equal(P.mem.why?.key, 'vs');
    assert.match(P.mem.why.msg, /Versus verrouillé/);
    P.setMode('progression', { persist: false });
    assert.equal(P.mem.why, null, 'changer de mode efface la raison');
    P.explain('region', 'cap sur Johto');
    P.explainClear('vs');
    assert.equal(P.mem.why?.key, 'region', 'on n’efface que la raison concernée');
    P.explainClear('region');
    assert.equal(P.mem.why, null);
  } finally { P.mem.why = null; P.setMode('progression', { persist: false }); }
});

test('Casino : jusqu’au jackpot tant que Porygon manque, puis seuil et limite par visite', () => {
  P.setOption('casino', true, { persist: false });
  P.Rt.D.config.slotMachine = { cost: 10, prizeDex: 137, prizeLevel: 30 };
  try {
    const hunt = { gold: 15, pokedex: [16] };
    assert.ok(P.casinoDecision(hunt).play, 'Porygon manquant : on tourne même avec ₽15');
    assert.ok(P.casinoDecision(hunt).hunt);
    assert.ok(!P.casinoDecision({ gold: 9, pokedex: [16] }).play, 'moins que le prix du tour');
    P.setOption('casinoHuntKeep', 10, { persist: false });
    assert.ok(!P.casinoDecision(hunt).play, '₽15 − ₽10 < ₽10 gardés');
    P.setOption('casinoHuntKeep', 0, { persist: false });

    P.setOption('casinoKeep', 1000, { persist: false });
    P.setOption('casinoMaxSpins', 20, { persist: false });
    P.setOption('casinoMaxLoss', 100, { persist: false });
    const have = (gold) => ({ gold, pokedex: [16, 137] });
    assert.ok(!P.casinoDecision(have(1005)).play, 'Porygon obtenu : ₽1005 − ₽10 sous le seuil de ₽1000');
    assert.ok(P.casinoDecision(have(1010)).play, 'au seuil après le tour : on joue');
    assert.ok(!P.casinoDecision(have(5000), { funGold: 5000, funSpins: 20 }).play, '20 tours joués dans la visite');
    assert.ok(!P.casinoDecision(have(4900), { funGold: 5000, funSpins: 5 }).play, '₽100 perdus dans la visite');
    assert.ok(P.casinoDecision(have(4950), { funGold: 5000, funSpins: 5 }).play, '₽50 perdus, 5 tours : on continue');

    P.setOption('casino', false, { persist: false });
    assert.ok(!P.casinoDecision(hunt).play, 'casino désactivé');
  } finally { P.setOption('casino', true, { persist: false }); delete P.Rt.D.config.slotMachine; }
});
