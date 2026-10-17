// Tests du moteur (pur, sans DOM) — `node --test pokedice-bot.test.js`
// Les cas "observés" sont des lancers relevés en jeu avec les dégâts affichés par Pokédice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildData, Engine } = require('./pokedice-bot.user.js');

const D = buildData(null); // données de repli (bundle v125)
const E = Engine(D);
const face = (type, v) => D.dice[type].faces.find((f) => f.value === v && f.kind === 'number') ?? D.dice[type].faces.find((f) => f.value === v);
const roll = (...pairs) => pairs.map(([type, v]) => ({ type, face: face(type, v) }));
const L1 = { comboLevels: {}, dieLevels: {} };

test('dégâts : cas observés en jeu (niveaux 1)', () => {
  const ctx = (def) => ({ attackerTypes: ['grass', 'poison'], defTypes: def, levels: L1 });
  assert.equal(E.damage(roll(['grass', 4], ['base', 4]), ctx(['normal', 'flying'])).final, 5);  // (4+4+paire 2)×0,5
  assert.equal(E.damage(roll(['grass', 5], ['base', 6]), ctx(['normal', 'flying'])).final, 6);  // 5,5 → 6
  assert.equal(E.damage(roll(['grass', 5], ['base', 1]), ctx(['normal', 'flying'])).final, 3);
  assert.equal(E.damage(roll(['grass', 4], ['base', 6]), ctx(['normal'])).final, 10);
});

test('dégâts : améliorations de dé et de combo', () => {
  const lv = { comboLevels: { pair: 2 }, dieLevels: { normal: 7, flying: 1 } };
  // Le repli ne connaît que le niveau 1 des combos : on vérifie au moins le bonus de dé absent sans table
  const r = E.damage(roll(['normal', 3]), { attackerTypes: ['normal', 'flying'], defTypes: ['normal'], levels: lv });
  assert.equal(r.attackType, 'normal');
  assert.ok(r.final >= 3);
});

test('type d\'attaque : meilleure efficacité, puis nombre de dés, puis STAB', () => {
  // Kabuto (eau + roche) contre Roucoups : la roche est super efficace → ×2
  const r = E.damage(roll(['water', 3], ['rock', 2]), { attackerTypes: ['rock', 'water'], defTypes: ['normal', 'flying'], levels: L1 });
  assert.equal(r.attackType, 'rock');
  assert.equal(r.mult, 2);
});

test('immunité : 0 dégât', () => {
  const r = E.damage(roll(['normal', 6]), { attackerTypes: ['normal'], defTypes: ['ghost'], levels: L1 });
  assert.equal(r.final, 0);
  assert.equal(r.immune, true);
});

test('combos (port de O4)', () => {
  assert.deepEqual(E.combosIn([2, 3, 4, 5, 6]), ['small_straight', 'full_straight']);
  assert.deepEqual(E.combosIn([1, 1, 2, 2, 2]), ['pair', 'two_pair', 'three_kind', 'full_house']);
  assert.deepEqual(E.combosIn([1, 3, 5]), []);
});

test('soin : 2 faces Soin → PV = total des dés', () => {
  const heal = D.dice.grass.faces.find((f) => f.status === 'heal');
  const dice = [{ type: 'grass', face: heal }, { type: 'grass', face: heal }, { type: 'base', face: face('base', 5) }];
  assert.equal(E.statusesOf(dice).heal, 11);
  // L'utilité valorise le soin quand on est bas en PV
  const low = E.utility(dice, { attackerTypes: ['grass'], defTypes: ['water'], levels: L1, foe: { hp: 99, maxHp: 99, expDmg: 6 }, me: { hp: 5, maxHp: 30, expDmg: 8 } });
  const full = E.utility(dice, { attackerTypes: ['grass'], defTypes: ['water'], levels: L1, foe: { hp: 99, maxHp: 99, expDmg: 6 }, me: { hp: 30, maxHp: 30, expDmg: 8 } });
  assert.ok(low.u > full.u);
});

test('relance : jamais si le coup tue déjà', () => {
  const c = E.chooseReroll(roll(['base', 6]), { attackerTypes: [], defTypes: [], levels: L1, foe: { hp: 5, maxHp: 20, expDmg: 3 }, me: { hp: 10, maxHp: 20, expDmg: 4 } });
  assert.equal(c.idx, null);
  assert.equal(c.reason, 'kill');
});

test('relance : relance le dé faible quand le gain est net', () => {
  const c = E.chooseReroll(roll(['fighting', 7], ['base', 1]), { attackerTypes: ['fighting'], defTypes: ['normal'], levels: L1, foe: { hp: 200, maxHp: 200, expDmg: 5 }, me: { hp: 30, maxHp: 30, expDmg: 8 } });
  assert.deepEqual(c.idx, [1]);
});

test('performance : fin de jeu (6 dés) sans geler la page', () => {
  // Espèce fictive à 6 dés : avant v0.5, avgDamage énumérait 46 656 issues (~85 ms) et
  // le Centre en enchaînait des centaines → plus d'une minute de page figée.
  D.species[9999] = { dex: 9999, type1: 'dragon', type2: 'fire', baseHp: 50, maxHp: 300, speed: 5, rerolls: 2, milestones: [], dice: [{ type: 'dragon', count: 3 }, { type: 'fire', count: 2 }, { type: 'base', count: 1 }] };
  const s = E.speciesAt(9999, 60);
  const ctx = { attackerTypes: s.types, defTypes: ['grass'], levels: { comboLevels: { pair: 4 }, dieLevels: {} } };
  const t = performance.now();
  const v = E.avgDamage(s.dice, ctx);
  assert.ok(performance.now() - t < 50, 'avgDamage 6 dés doit rester sous 50 ms');
  assert.equal(E.avgDamage(s.dice, ctx), v, 'échantillonnage déterministe : même résultat');
  const dice = s.dice.map((type) => ({ type, face: D.dice[type].faces[0] }));
  const t2 = performance.now();
  E.chooseReroll(dice, { ...ctx, foe: { hp: 400, maxHp: 400, expDmg: 20 }, me: { hp: 150, maxHp: 200, expDmg: 40 } });
  assert.ok(performance.now() - t2 < 1000, 'une décision de relance à 6 dés doit rester sous 1 s');
});

test('boss réel (Pierre, Forêt de Jade) : la Plante répond, la Normal non', () => {
  // Données extraites du jeu : Racaillou N.12 + Onix N.14 contre la Boîte de la partie de test
  const F = require('./fixtures/brock.json');
  const D2 = buildData(null);
  D2.chart = {}; for (const [a, d, m] of F.chart) D2.chart[`${a}>${d}`] = m;
  for (const p of F.pk) D2.species[p.dex] = p;
  const E2 = Engine(D2);
  const mon = (dex, level) => { const st = E2.speciesAt(dex, level); return { stats: st, hp: st.maxHp, levels: F.levels }; };
  const boss = F.brock.map((b) => { const st = E2.speciesAt(b.dex, b.level); return { stats: st, hp: st.maxHp, levels: E2.allLevels(1) }; });
  const best = (team) => boss.map((b) => Math.max(...team.map((m) => E2.duelScore(m, b).score)));
  const normalTeam = best([mon(16, 15), mon(19, 14), mon(21, 12)]);
  const withGrass = best([mon(1, 10)]);
  assert.ok(Math.max(...normalTeam) < 1, 'Normal/Vol perd contre Roche/Sol');
  assert.ok(Math.min(...withGrass) > 1.2, 'Bulbizarre (Plante, ×2) gagne contre les deux');
});
