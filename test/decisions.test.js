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
  assert.equal(by[10].key, 'poke-ball', 'Chenipan : la Poké Ball donne 100 %');
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
  assert.equal(P.chooseBall(opts, { rare: true, why: 'nouvelle espèce' }).t, 'hyper', 'nouvelle espèce : la moins chère ≥ 90 %');
  assert.equal(P.chooseBall(opts, { rare: true, why: 'chromatique' }).t, 'hyper', 'chromatique : meilleure chance, sans Master Ball');
  assert.equal(P.chooseBall(opts, { legendary: true }).t, 'hyper', 'à chance égale, la moins chère (pas la Master)');
  assert.equal(P.chooseBall(opts, {}).t, 'poke', 'espèce connue : la moins chère');
  P.setOption('catchKnown', 'free', { persist: false });
  assert.equal(P.chooseBall(opts, {}).t, 'sans', 'option Sans Ball');
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
  assert.deepEqual(P.missingSpecies(P.Rt.D.areas.forest, save), [10], 'évolutions : recapturer Chenipan pour obtenir Chrysacier/Papilusion');
  assert.equal(P.desiredArea(save)?.id, 'forest');
  // On possède un Chrysacier : plus besoin de recapturer, il suffit de l'entraîner → on avance
  save = setup({ box: [['p', 16, 15], ['m', 11, 8]], team: ['p', 'm'], pokedex: [10, 11, 25, 16], area: 'forest' });
  assert.deepEqual(P.missingSpecies(P.Rt.D.areas.forest, save), []);
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
  const t0 = performance.now();
  const best = P.bestVersusTeam(save, foes);
  const ms = performance.now() - t0;
  assert.equal(best.dex.length, 3);
  assert.ok(ms < 500, `choix d'équipe en ${ms.toFixed(0)} ms (doit rester < 500 ms)`);
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