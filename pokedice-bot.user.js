// ==UserScript==
// @name         Pokédice Autopilot
// @namespace    pokedice-bot
// @version      1.7.0
// @description  Joue à Pokédice — modes Progression / Pokédex / Farm / Versus / Raids : combats optimisés, soins, captures, boutique, améliorations, Centre, zones.
// @match        https://poke-dice.netlify.app/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/AlexTournant/poke-dice
// @supportURL   https://github.com/AlexTournant/poke-dice/issues
// @updateURL    https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js
// ==/UserScript==

/*
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ARCHITECTURE                                                             │
 * │  1. CONFIG      réglages                                                 │
 * │  2. Data        données du jeu lues au runtime (IndexedDB + i18n du      │
 * │                 bundle) avec repli embarqué                              │
 * │  3. Engine      PUR, sans DOM : stats d'espèce, dégâts (port de Qc),     │
 * │                 statuts, soin, espérance de relance, menace adverse      │
 * │  4. Dom         helpers : libellés i18n → boutons, lecture sauvegarde    │
 * │  5. Screens     détection de l'écran courant                             │
 * │  6. Policies    battle · items · encounter · center · catch · victory ·  │
 * │                 area · shop · upgrades · zones                           │
 * │  7. Bot         boucle tick, verrou async, garde-fous                    │
 * │  8. Modes       progression · pokedex · farm (setMode, localStorage)     │
 * │  9. UI          barre ON/OFF + mode + 🔒 + ₽/h, panneau ⚙️ (Shadow DOM), │
 * │                 menu Tampermonkey, Alt+B                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 * Console : window.PokeBot  (bot, CONFIG, setMode('farm'), journal, Rt…)
 */

(() => {
  'use strict';
  const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined' && !!document.body;
  const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : typeof window !== 'undefined' ? window : globalThis; // eslint-disable-line no-undef

  /* ═════════════════════════════ 1. CONFIG ═════════════════════════════ */
  const CONFIG = {
    // Rythme : le bot réagit aux changements de l'écran (MutationObserver) au lieu d'attendre un délai fixe
    tickMs: 250,                  // filet de sécurité si aucun changement d'écran n'est détecté
    minActionGapMs: 120,          // écart minimal entre deux actions (laisse React redessiner)
    actionCooldownMs: 900,        // attente MAX d'une réaction de l'écran après une action
    shortAnimations: true,        // règle le jeu sur "Animations : Courtes" (réglage joueur standard)
    stopAfterIdleTicks: 70,
    autoResume: true,             // relance le bot après un rechargement de la page (le jeu se recharge parfois seul)

    // Relances (même logique que l'IA du jeu : gain relatif minimal)
    rerollMinGain: 1,
    rerollMinGainRatio: 0.08,

    // Soin
    //   eco    : seulement si le prochain coup peut mettre K.O. ET (dresseur/arène/boss/capture rare OU équipe de secours faible)
    //   normal : danger, ou PV bas contre un dresseur/arène/boss
    //   safe   : danger ou PV bas, partout (ancien comportement)
    healPolicy: 'eco',
    ecoBackupRatio: 0.35,       // eco : soigne aussi un sauvage si les PV des autres Pokémon < 35 % de l'équipe
    potionBelowHpRatio: 0.35,   // seuil "PV bas"
    dangerMargin: 1.25,         // menace adverse × marge >= PV restants  → danger
    cureBurnPoisonBelow: 0.6,   // soigne brûlure/poison si PV < 60 %

    // Avant-combat
    manageLead: true,
    switchOnNewFoe: true,         // dresseur / arène / boss : à chaque nouveau Pokémon adverse, change si le match-up est mauvais
    switchBelow: 1.0,             // …si notre duel est perdant (< 1), ou < 1,3 quand il nous touche en super efficace
    switchGain: 1.4,              // …et qu'un autre Pokémon fait au moins 40 % mieux (le changement coûte le tour)
    leadSwitchGain: 1.3,        // change de meneur si son score est 30 % meilleur
    fleeIfBestScoreBelow: 0.45, // fuit un sauvage si même le meilleur meneur est très défavorisé
    avoidTrainerIfBelow: 0.35,

    // Boss / zones
    bossLevelMargin: 0,         // niveau moyen du top 3 >= niveau max de la zone + marge
    maxExtraRounds: 3,          // au-delà, on défie quand même
    nextAreaLevelSlack: 2,      // niveau moyen >= niveau min de la zone suivante − slack
    autoTravel: true,

    // Mode de jeu (choisi dans le panneau, mémorisé dans localStorage)
    //   progression : enchaîne les zones et les arènes
    //   pokedex     : reste / revient dans les zones où il manque des espèces sauvages
    //   farm        : reste dans une zone (même terminée) : XP, ₽, chromatiques
    mode: 'progression',
    farmAreaId: null,             // zone de farm (par défaut : zone courante au moment du choix)
    pokedexFleeKnownMargin: 2,
    pokedexStallEncounters: 40,   // mode Pokédex : N rencontres sans nouvelle espèce → la zone est mise de côté…
    pokedexStallMinutes: 30,      // …pendant N minutes    // mode Pokédex : fuit les espèces déjà capturées si l'équipe dépasse le niveau max de la zone de +N

    // Économie — rappel : seuls les dresseurs et arènes paient (niveau × 0,5 ; arène ×2 ; zone terminée ×0,5)
    economy: true,
    goldReserve: 20,
    // Ce que le bot a le droit d'acheter (panneau ⚙️ → Dépenses)
    buy: { heal: true, ball: true, rareBall: true, cure: true, ether: true, dieUpgrades: true, comboUpgrades: true, offline: true, luck: false, sell: true, bait: true, fossil: true },
    pokedexLuck: true,            // mode Pokédex (captures) : achète "Chance de capture" même si buy.luck est coupé
    // Stocks de REPLI (avant d'avoir mesuré la consommation réelle). Un objet plus fort compte pour un plus faible.
    stock: { heal: 4, ball: 8, rareBall: 2, cure: 1, ether: 1, bait: 3 },
    stockHorizon: 25,             // stocks dimensionnés pour ~25 rencontres de consommation mesurée
    rateWindow: 60,               // consommation mesurée sur les 60 dernières rencontres
    healMaxStock: 10,
    ballMaxStock: 25,
    ballMinStock: 4,              // sous ce seuil de Balls (toutes confondues), achat prioritaire
    healMinStock: 2,              // sous ce seuil de soins (du bon palier), achat prioritaire
    bossHealStock: 4,             // boss en attente : au moins N soins du bon palier (réserve avant le combat qui compte)
    healTargetRatio: 0.5,         // palier de soin acheté : il doit rendre ≥ 50 % des PV max du plus gros Pokémon de l'équipe
    shopShares: { heal: 0.35, ball: 0.3, rareBall: 0.25, stone: 0.4, cure: 0.1, ether: 0.1, bait: 0.15, fossil: 0.5, urgent: 0.6 }, // part max de l'or par famille
    minBasket: 40,                // pas de trajet boutique pour moins de ₽40 d'achats (sauf urgence)
    // Améliorations
    upgradeStrategy: 'save',      // 'save' : épargne pour la plus rentable ; 'greedy' : la meilleure abordable tout de suite
    upgradeSaveRatio: 0.75,       // en épargne, on n'achète autre chose que si sa rentabilité ≥ 75 % de la meilleure
    upgradeBoxWeight: 0.35,       // poids des dés des meilleurs Pokémon de la Boîte (l'équipe change)
    upgradeBossBoost: 1.5,        // dés super efficaces contre le boss en attente
    upgradeShare: 1,              // part de l'or disponible (après réserves) que les améliorations peuvent prendre
    offlineMaxLevel: 2,           // "Gains hors ligne" : niveau max acheté (N.1 ₽100 → 2/h, N.2 ₽175 → 4/h…)
    luckMaxLevel: 1,              // "Chance de capture" (si autorisée)
    // Revente (la boutique rachète à moitié prix)
    sellAbove: 40,                // au-delà de N exemplaires d'un consommable, on revend jusqu'à N/2
    sellObsoleteHeals: true,      // soins devenus trop faibles (< 20 % des PV de l'équipe) : on en garde 2
    sellDeadStones: false,        // objets d'évolution sans aucun usage possible avec la Boîte actuelle
    reportMinutes: 10,            // bilan financier dans le journal toutes les N minutes
    showGoldRate: false,          // barre : or actuel + ₽ gagnés par heure
    showStatus: true,             // barre : dernière action du bot (ligne sous les boutons)
    // Évolutions par objet (Pierres…) : Équipe → Pokémon → UTILISER UN OBJET
    useEvolutionItems: true,      // utilise les objets du Sac qui font évoluer en une espèce absente du Pokédex
    buyEvolutionItems: 'pokedex', // achète les objets manquants : 'pokedex' (mode Pokédex seulement), 'always' ou 'never'
    urgentBudgetRatio: 0.8,       // part max de l'or pour atteindre le stock plancher de Balls
    consumableBudgetRatio: 0.45,  // part max de l'or pour les autres consommables

    // Centre
    manageTeam: true,
    lockTeam: false,              // 🔒 équipe verrouillée : le Centre ne change ni la composition ni le meneur
    trainWeakest: false,          // meneur = le moins haut niveau qui gagne son duel sans risque (pour monter des Pokémon)
    trainMinScore: 1.3,           // duel minimal pour envoyer un Pokémon "en formation"

    // Boss (arène, Conseil 4, Maître, légendaire) : préparation avant de défier
    bossReadyScore: 1.2,          // moyenne, sur chaque Pokémon du boss, du meilleur duel de l'équipe
    bossWorstScore: 0.7,          // et aucun Pokémon du boss ne doit être sans réponse
    bossFailMargin: 0.25,         // chaque défaite contre ce boss relève l'exigence de 25 %
    bossTraineeGain: 1.2,         // un "contre" de la Boîte entre en formation s'il ferait 20 % mieux au niveau du boss

    // Capture : chance exacte = (7 − (difficulté − bonus Ball)) / 6, difficulté 1–9 par espèce
    catchNewPct: 100,             // nouvelle espèce : Ball la moins chère qui atteint ce % (sinon la meilleure) — 100 = toujours la meilleure chance
    catchKnown: 'cheap',          // espèce déjà au Pokédex : 'free' (Sans Ball), 'cheap' (Ball la moins chère), 'normal' (catchMinPct)
    catchMinPct: 80,              // 'normal' : Ball la moins chère qui atteint ce %
    catchRarePct: 95,             // chromatique ou légendaire : la meilleure chance possible
    catchTarget: '',              // espèce visée (nom affiché par le jeu) : le bot va dans la meilleure zone pour elle et la capture
    farmGoal: 'xp',               // mode Farm : 'xp' (zone choisie), 'xpAuto' (zone qui rapporte le plus d'XP sans risque) ou 'gold'
    // XP : porteur + élèves (Multi Exp du jeu : un Pokémon ≥ 14 niveaux sous le combattant reçoit 100 % de l'XP sans combattre)
    xpTrainees: true,             // au Centre : le plus fort porte l'équipe, les autres places vont à des élèves de la Boîte
    carrierSafeScore: 1.6,        // ↳ duel moyen du porteur contre la zone sous lequel on garde 2 porteurs (1 seul élève)
    xpLead: true,                 // meneur choisi pour l'XP utile (pas d'XP perdue au niveau max), parmi les duels sans risque
    dexFocus: 'catch',            // mode Pokédex : 'catch' (espèces sauvages jamais capturées) ou 'evo' (évolutions manquantes)
    // Activités (modes Versus / Raids) : le bot y va quand c'est ouvert, sinon il joue dans le mode de repli
    activity: null,
    activityFallback: 'progression',
    versusAutoTeam: true,         // compose l'équipe Versus (simulation 3 contre 3 au N.50 contre les équipes adverses)
    versusMinMargin: -0.1,        // n'affronte pas une équipe si la simulation prévoit une défaite nette
    versusRecheckMin: 30,         // plus rien à battre : on revient voir dans N minutes
    versusPauseSec: 4,            // pause entre deux combats Versus (ménage le serveur)
    raidDaily: true,              // raid du jour
    raidLegendary: true,          // raids légendaires des zones terminées
    raidMaxTries: 8,              // essais par raid et par jour avant d'aller s'entraîner
    raidAutoTeam: true,           // compose l'équipe de raid contre le boss à chaque raid
    raidFriends: true,            // ajoute au groupe les amis dont l'équipe de raid est la plus recommandée contre le boss
    raidMinOdds: 0.6,             // dégâts estimés (toi + alliés) / PV totaux du boss : en dessous, on arrête après 2 défaites…
    raidTrain: true,              // …et on entraîne au Centre le meilleur « contre » du boss qui n'a pas le niveau plafond
    // Événements et routines (tous modes)
    eventWheel: true,             // Roue de la fortune : un tour gratuit par jour
    rebattle: false,              // Revanche du Conseil 4 : enchaîne les paliers quand l'équipe est prête (5 combats sans Centre)
    rebattleReadyScore: 1.4,      // ↳ duel moyen exigé contre les équipes du palier
    rebattleMaxTries: 3,          // ↳ défaites par jour avant d'attendre le lendemain
    dayCare: true,                // Pension : fait éclore les Œufs et y laisse un couple de la Boîte (Œufs : espèces absentes ×4)
    dayCareCheckMin: 20,          // ↳ passe à la Pension au plus toutes les N minutes (sauf Œuf qui attend)
    // Confort
    notify: true,                 // notification du navigateur : chromatique, légendaire, boss, Œuf chromatique, bot arrêté
    notifySound: true,            // ↳ petit son en plus
    keepAwake: true,              // empêche l'écran (et donc le PC) de se mettre en veille tant que le bot tourne
    schedule: '',                 // planning : "08:00-23:00=pokedex; 23:00-08:00=farm" (vide = désactivé)               // mode Farm : 'xp' (zone choisie) ou 'gold' (zone qui rapporte le plus de ₽ par rencontre)

    // Performance (fin de jeu : Pokémon à 5-6 dés, grosse Boîte)
    exactEnumLimit: 1296,         // ≤ 6^4 issues → calcul exact ; au-delà, échantillonnage déterministe
    mcSamples: 400,               // tirages par estimation échantillonnée (erreur typique < 2 %)
    centerMaxBox: 12,             // Centre : on n'évalue que les N meilleurs niveaux de la Boîte…
    centerMaxThreats: 10,         // …contre les N menaces les plus fréquentes de la zone
    centerTimeBudgetMs: 1500,     // au-delà, on garde l'équipe actuelle plutôt que de figer la page

    debug: true,
  };

  /** Réglages propres à chaque mode (appliqués par-dessus CONFIG). */
  const MODES = {
    progression: { label: 'Progression', stock: { heal: 4, ball: 8, rareBall: 2, cure: 1, ether: 1, bait: 2 }, lockTeam: false, trainWeakest: false },
    pokedex: { label: 'Pokédex : captures', dexFocus: 'catch', stock: { heal: 4, ball: 10, rareBall: 4, cure: 1, ether: 1, bait: 4 }, lockTeam: false, trainWeakest: false },
    pokedexEvo: { label: 'Pokédex : évolutions', baseMode: 'pokedex', dexFocus: 'evo', stock: { heal: 4, ball: 6, rareBall: 2, cure: 1, ether: 1, bait: 1 }, lockTeam: false, trainWeakest: false },
    // Farm : ton équipe est respectée (verrouillée) ; le meneur est choisi pour l'XP utile (voir xpLead)
    farm: { label: 'Farm', stock: { heal: 5, ball: 8, rareBall: 3, cure: 1, ether: 1, bait: 2 }, lockTeam: true, trainWeakest: false },
    versus: { label: 'Versus', activity: true },
    raid: { label: 'Raids', activity: true },
  };
  const DEFAULTS = JSON.parse(JSON.stringify(CONFIG)); // valeurs d'usine (bouton "Réinitialiser" du panneau)
  const SETTINGS_KEY = 'pokebot.settings';

  /* ═════════════════════════════ 2. DATA ═════════════════════════════ */
  // Repli minimal si IndexedDB est indisponible (valeurs du bundle v125).
  const FALLBACK = {
    diceTypes: [
      ['base', [1, 2, 3, 4, 5, 6], false, false], ['normal', [1, 2, 3, 4, 5, 6]],
      ['fire', [['burn', 1], 2, 3, 4, 5, 6]], ['water', [2, 3, 3, 4, 4, 5]],
      ['electric', [1, 2, 3, ['paralyze', 4], 5, 6]], ['grass', [1, 2, ['heal', 3], 4, 5, 6]],
      ['ice', [['frozen', 1], 2, 3, 4, 5, 6]], ['fighting', [2, 3, 4, 5, 6, 7]],
      ['poison', [['poison', 1], 2, 3, 4, 5, 6]], ['ground', [0, 1, 1, 4, 4, 8]],
      ['flying', [1, 2, 3, 4, 4, 7]], ['psychic', [1, 2, 3, 4, 5, ['confuse', 2]]],
      ['bug', [1, 1, 1, 4, 4, 4]], ['rock', [2, 2, 2, 4, 5, 6]], ['ghost', [0, 0, 3, 5, 6, 7]],
      ['dragon', [2, 3, 4, 5, 6, 8]], ['dark', [1, 1, 3, 4, 5, 7]], ['steel', [3, 3, 3, 4, 4, 4]],
      ['fairy', [0, 2, 2, 4, 4, 6]],
    ].map(([type, faces, upgradeable = true, countsForMajority = true]) => ({
      type, upgradeable, countsForMajority,
      faces: faces.map((f) => (Array.isArray(f) ? { kind: 'status', status: f[0], value: f[1] } : { kind: 'number', value: f })),
    })),
    comboBonusL1: { pair: 2, two_pair: 5, three_kind: 6, small_straight: 8, full_house: 10, four_kind: 14, full_straight: 18, five_kind: 25 },
    status: {
      burn: { duration: 3, threshold: 1, percentPerStack: 4 }, heal: { amount: 'rollTotal', threshold: 2 },
      frozen: { stunTurns: 2, threshold: 3 }, poison: { percent: 10, duration: 3, threshold: 2 },
      confuse: { threshold: 2, recoilPercent: 20 }, paralyze: { stunTurns: 1, threshold: 2 },
    },
  };

  const COMBOS = ['pair', 'two_pair', 'three_kind', 'small_straight', 'full_house', 'four_kind', 'full_straight', 'five_kind'];
  const LANGS = ['en', 'fr', 'es', 'de', 'it', 'pt', 'pt-BR', 'ja', 'ko', 'zh-Hans'];

  /** Construit l'objet de données indexé utilisé par l'Engine. */
  function buildData(bundle) {
    const D = {
      source: bundle ? 'indexeddb' : 'fallback',
      dice: {}, chart: {}, comboUp: {}, dieUp: {}, status: FALLBACK.status, config: {},
      species: {}, items: {}, areas: {}, areaList: [], trainers: {}, regions: {}, eggGroups: bundle?.eggGroups ?? {},
    };
    for (const d of bundle?.diceTypes ?? FALLBACK.diceTypes) D.dice[d.type] = d;
    for (const r of bundle?.typeChart ?? []) D.chart[`${r.attacking}>${r.defending}`] = r.multiplier;
    if (!bundle) {
      // table d'efficacité de repli (attaquant>défenseur)
      const T = { bug: 'dark2 fairy.5 fighting.5 fire.5 flying.5 ghost.5 grass2 poison.5 psychic2 steel.5', dark: 'dark.5 fairy.5 fighting.5 ghost2 psychic2', dragon: 'dragon2 fairy0 steel.5', electric: 'dragon.5 electric.5 flying2 grass.5 ground0 water2', fairy: 'dark2 dragon2 fighting2 fire.5 poison.5 steel.5', fighting: 'bug.5 dark2 fairy.5 flying.5 ghost0 ice2 normal2 poison.5 psychic.5 rock2 steel2', fire: 'bug2 dragon.5 fire.5 grass2 ice2 rock.5 steel2 water.5', flying: 'bug2 electric.5 fighting2 grass2 rock.5 steel.5', ghost: 'dark.5 ghost2 normal0 psychic2', grass: 'bug.5 dragon.5 fire.5 flying.5 grass.5 ground2 poison.5 rock2 steel.5 water2', ground: 'bug.5 electric2 fire2 flying0 grass.5 poison2 rock2 steel2', ice: 'dragon2 fire.5 flying2 grass2 ground2 ice.5 steel.5 water.5', normal: 'ghost0 rock.5 steel.5', poison: 'fairy2 ghost.5 grass2 ground.5 poison.5 rock.5 steel0', psychic: 'dark0 fighting2 poison2 psychic.5 steel.5', rock: 'bug2 fighting.5 fire2 flying2 ground.5 ice2 steel.5', steel: 'electric.5 fairy2 fire.5 ice2 rock2 steel.5 water.5', water: 'dragon.5 fire2 grass.5 ground2 rock2 water.5' };
      for (const [a, s] of Object.entries(T)) for (const tok of s.split(' ')) { const m = tok.match(/^([a-z]+)([\d.]+)$/); D.chart[`${a}>${m[1]}`] = +m[2]; }
    }
    const up = bundle?.upgrades;
    for (const r of up?.combos ?? []) (D.comboUp[r.comboKey] ??= []).push(r);
    for (const r of up?.dice ?? []) (D.dieUp[r.dieType] ??= []).push(r);
    if (!up) for (const [k, b] of Object.entries(FALLBACK.comboBonusL1)) D.comboUp[k] = [{ level: 1, bonus: b, cost: 0 }];
    for (const l of [...Object.values(D.comboUp), ...Object.values(D.dieUp)]) l.sort((a, b) => a.level - b.level);
    D.config = bundle?.config ?? { hpMultiplier: 1, comboPayoutMode: 'highestDamage', maxTeamSize: 3 };
    if (bundle?.config?.status) D.status = bundle.config.status;
    for (const p of bundle?.pokemon ?? []) D.species[p.dex] = p;
    for (const it of bundle?.items ?? []) D.items[it.key] = it;
    D.areaList = [...(bundle?.areas ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
    for (const a of D.areaList) D.areas[a.id] = a;
    for (const t of bundle?.trainers ?? []) D.trainers[t.id] = t;
    for (const r of bundle?.regions ?? []) D.regions[r.id] = r;
    return D;
  }

  /* ═════════════════════════════ 3. ENGINE (pur) ═════════════════════════════ */
  const Engine = (D) => {
    const faceVal = (f) => (typeof f === 'number' ? f : f?.value ?? 0);
    const faceStatus = (f) => (f && typeof f === 'object' && f.kind === 'status' ? f.status : null);
    const facesOf = (type) => D.dice[type]?.faces ?? D.dice.base.faces;

    /** Port de Ko() : dés, relances, PV max, types d'une espèce à un niveau. */
    function speciesAt(dex, level) {
      const sp = D.species[dex];
      if (!sp) return null;
      const dice = [];
      for (const d of sp.dice ?? []) for (let i = 0; i < d.count; i++) dice.push(d.type);
      let rerolls = sp.rerolls ?? 0, addHp = 0;
      const ms = [...(sp.milestones ?? [])].filter((m) => m.level <= level).sort((a, b) => a.level - b.level);
      const coloredCount = () => dice.filter((t) => t !== 'base').length;
      for (const m of ms) {
        switch (m.effect) {
          case 'UPGRADE_DIE': case 'REPLACE_DIE': {
            const from = m.effect === 'UPGRADE_DIE' ? 'base' : m.fromDieType ?? 'base';
            const to = m.dieType ?? sp.type1;
            const i = dice.indexOf(from);
            if (i < 0 || from === to) break;
            dice.splice(i, 1);
            if (to === 'base') dice.push(to); else dice.splice(coloredCount(), 0, to);
            break;
          }
          case 'ADD_REROLL': rerolls += m.amount ?? 1; break;
          case 'ADD_DIE': dice.splice(coloredCount(), 0, m.dieType ?? sp.type1); break;
          case 'ADD_HP': addHp += m.amount ?? 0; break;
        }
      }
      const lin = Math.round(sp.baseHp + (sp.maxHp - sp.baseHp) * (level - 1) / 99);
      const maxHp = Math.max(1, Math.round((lin + addHp) * (D.config.hpMultiplier ?? 1)));
      return { dex, level, dice, rerolls, maxHp, speed: sp.speed ?? 0, types: sp.type2 ? [sp.type1, sp.type2] : [sp.type1] };
    }

    /** Efficacité bornée [0,5 ; 2] (0 = immunité), port de Oc(). */
    function eff(atk, defTypes) {
      if (atk === 'base') return 1;
      let n = 1;
      for (const d of defTypes) n *= D.chart[`${atk}>${d}`] ?? 1;
      return n === 0 ? 0 : Math.min(Math.max(n, 0.5), 2);
    }

    /**
     * Port de cJ() : efficacité remplacée par une échelle propre au mode (raids : levels.typeScale).
     * Sans échelle, l'efficacité est inchangée.
     */
    const scaleEff = (e, s) => (!s ? e : e === 0 ? s.immune : e > 1 ? s.super : e < 1 ? s.resisted : e);

    /** Port de Q4() : type de l'attaque = meilleur tuple (efficacité, nb de dés, STAB, valeur max). */
    function attackType(dice, attackerTypes, defTypes) {
      const count = new Map(), best = new Map();
      for (const d of dice) {
        if (d.type === 'base' || !D.dice[d.type]?.countsForMajority) continue;
        count.set(d.type, (count.get(d.type) ?? 0) + 1);
        best.set(d.type, Math.max(best.get(d.type) ?? -Infinity, faceVal(d.face)));
      }
      if (!count.size) return null;
      const [t1, t2] = attackerTypes ?? [];
      const key = (t) => [eff(t, defTypes), count.get(t), t === t1 ? 2 : t === t2 ? 1 : 0, best.get(t)];
      const gt = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
      return [...count.keys()].reduce((acc, t) => (gt(key(t), key(acc)) ? t : acc));
    }

    const levelBonus = (list, level) => {
      if (!list?.length) return 0;
      const i = Math.min(list.length, Math.max(1, Math.floor(level ?? 1)));
      return list[i - 1]?.bonus ?? 0;
    };
    const dieBonus = (type, levels) => (type === 'base' || !D.dice[type]?.upgradeable ? 0 : levelBonus(D.dieUp[type], levels?.dieLevels?.[type]));
    const comboBonus = (key, levels) => levelBonus(D.comboUp[key], levels?.comboLevels?.[key]);

    /** Port de O4() : combos présents dans un lancer. */
    function combosIn(values) {
      const m = new Map();
      for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
      const c = [...m.values()].sort((a, b) => b - a);
      const n = c[0] ?? 0, i = c[1] ?? 0, groups = c.filter((x) => x >= 2).length;
      const u = [...new Set(values)].sort((a, b) => a - b);
      let run = u.length ? 1 : 0, cur = 1;
      for (let k = 1; k < u.length; k++) { cur = u[k] === u[k - 1] + 1 ? cur + 1 : 1; run = Math.max(run, cur); }
      const out = [];
      if (n >= 2) out.push('pair');
      if (groups >= 2) out.push('two_pair');
      if (n >= 3) out.push('three_kind');
      if (run >= 4) out.push('small_straight');
      if (n >= 3 && i >= 2) out.push('full_house');
      if (n >= 4) out.push('four_kind');
      if (run >= 5) out.push('full_straight');
      if (n >= 5) out.push('five_kind');
      return out;
    }

    /**
     * Port de Qc() : dégâts finaux d'un lancer.
     * @param {{type:string, face:object}[]} dice
     * @param {{attackerTypes:string[], defTypes:string[], levels:object}} ctx
     */
    function damage(dice, ctx) {
      const at = attackType(dice, ctx.attackerTypes, ctx.defTypes);
      const r = at ? scaleEff(eff(at, ctx.defTypes), ctx.levels?.typeScale) : 1;
      let sum = 0;
      const values = [];
      for (const d of dice) { const v = faceVal(d.face); values.push(v); sum += (v + dieBonus(d.type, ctx.levels)) * r; }
      const present = combosIn(values);
      let combo = null, cb = 0;
      if (D.config.comboPayoutMode === 'highestRank') { combo = present.at(-1) ?? null; cb = combo ? comboBonus(combo, ctx.levels) : 0; }
      else for (const k of present) { const b = comboBonus(k, ctx.levels); if (b > cb) { cb = b; combo = k; } }
      sum += cb * r;
      const immune = dice.length > 0 && r === 0;
      return { final: immune ? 0 : Math.max(1, Math.round(sum)), raw: sum, attackType: at, mult: r, combo, immune };
    }

    /** Port de Hh() : statuts déclenchés par un lancer. */
    function statusesOf(dice) {
      const S = D.status, n = {};
      for (const d of dice) { const s = faceStatus(d.face); if (s) n[s] = (n[s] ?? 0) + 1; }
      const out = {};
      if ((n.burn ?? 0) >= S.burn.threshold && n.burn > 0) out.burn = n.burn;
      if ((n.poison ?? 0) >= S.poison.threshold && n.poison > 0) out.poison = true;
      if ((n.frozen ?? 0) >= S.frozen.threshold && n.frozen > 0) out.frozen = S.frozen.stunTurns;
      if ((n.paralyze ?? 0) >= S.paralyze.threshold && n.paralyze > 0) out.paralyze = S.paralyze.stunTurns;
      if ((n.confuse ?? 0) >= S.confuse.threshold && n.confuse > 0) out.confuse = true;
      if ((n.heal ?? 0) >= S.heal.threshold && n.heal > 0) {
        out.heal = S.heal.amount === 'healFaces'
          ? dice.reduce((a, d) => a + (faceStatus(d.face) === 'heal' ? faceVal(d.face) : 0), 0)
          : dice.reduce((a, d) => a + faceVal(d.face), 0);
      }
      return out;
    }

    /**
     * Utilité d'un lancer, en "PV adverses équivalents".
     * ctx.foe = {hp, maxHp, expDmg}  ctx.me = {hp, maxHp, expDmg}
     */
    function utility(dice, ctx) {
      const dmg = damage(dice, ctx);
      const foeHp = ctx.foe?.hp ?? Infinity;
      const kill = dmg.final >= foeHp;
      let u = Math.min(dmg.final, foeHp);
      const st = statusesOf(dice);
      const S = D.status;
      const foeMax = ctx.foe?.maxHp ?? 50;
      const foeThreat = ctx.foe?.expDmg ?? 0.15 * (ctx.me?.maxHp ?? 30);
      if (kill) {
        u += foeThreat; // tuer maintenant évite sa prochaine attaque
      } else {
        const left = foeHp - dmg.final;
        if (st.burn) u += Math.min(left, st.burn * (S.burn.percentPerStack / 100) * foeMax * S.burn.duration);
        if (st.poison) u += Math.min(left, (S.poison.percent / 100) * foeMax * S.poison.duration);
        if (st.frozen) u += st.frozen * foeThreat;
        if (st.paralyze) u += st.paralyze * foeThreat;
        if (st.confuse) u += Math.min(left, (S.confuse.recoilPercent / 100) * foeMax);
      }
      if (st.heal && ctx.me) {
        // 1 PV soigné vaut (mes dégâts / ses dégâts) PV adverses : il m'achète du temps.
        const healed = Math.min(st.heal, ctx.me.maxHp - ctx.me.hp);
        const ratio = Math.min(3, Math.max(0.3, (ctx.me.expDmg ?? 5) / Math.max(1, foeThreat)));
        u += healed * ratio;
      }
      return { u, dmg, kill, st };
    }

    /**
     * Générateur pseudo-aléatoire déterministe (mulberry32) : un échantillonnage
     * donne toujours le même résultat pour la même entrée → décisions stables.
     */
    const seededRng = (seedStr) => {
      let a = 2166136261;
      for (let i = 0; i < seedStr.length; i++) a = Math.imul(a ^ seedStr.charCodeAt(i), 16777619);
      return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    };
    const spaceOf = (types) => types.reduce((p, t) => p * facesOf(t).length, 1);

    /**
     * Espérance de l'utilité en relançant les dés d'indices `idx`.
     * Exacte tant que l'espace est petit (≤ CONFIG.exactEnumLimit issues), sinon échantillonnée :
     * 6 dés = 46 656 issues → coût prohibitif répété sur chaque sous-ensemble.
     */
    function expectedUtility(dice, idx, ctx) {
      let total = 0, count = 0;
      const cur = dice.map((d) => ({ ...d }));
      if (spaceOf(idx.map((i) => dice[i].type)) <= CONFIG.exactEnumLimit) {
        const rec = (k) => {
          if (k === idx.length) { total += utility(cur, ctx).u; count++; return; }
          const i = idx[k];
          for (const f of facesOf(dice[i].type)) { cur[i].face = f; rec(k + 1); }
        };
        rec(0);
      } else {
        const rnd = seededRng(idx.join(',') + dice.map((d) => d.type + faceVal(d.face)).join(''));
        for (let s = 0; s < CONFIG.mcSamples; s++) {
          for (const i of idx) { const fs = facesOf(dice[i].type); cur[i].face = fs[(rnd() * fs.length) | 0]; }
          total += utility(cur, ctx).u; count++;
        }
      }
      return total / count;
    }

    /** Meilleur sous-ensemble à relancer (null si ça ne vaut pas une relance). */
    function chooseReroll(dice, ctx, cfg = CONFIG) {
      const now = utility(dice, ctx);
      if (now.kill) return { idx: null, base: now.u, ev: now.u, reason: 'kill' };
      let best = { idx: null, ev: now.u };
      for (let mask = 1; mask < 1 << dice.length; mask++) {
        const idx = dice.map((_, i) => i).filter((i) => mask & (1 << i));
        const ev = expectedUtility(dice, idx, ctx);
        if (ev > best.ev + 1e-9) best = { idx, ev };
      }
      const gain = best.ev - now.u;
      const need = Math.max(cfg.rerollMinGain, now.u * cfg.rerollMinGainRatio);
      return gain >= need ? { ...best, base: now.u, gain } : { idx: null, base: now.u, ev: now.u, gain };
    }

    /**
     * Espérance des dégâts d'un lancer aléatoire (sans relance).
     * Exacte jusqu'à CONFIG.exactEnumLimit issues (4 dés), échantillonnée au-delà.
     * Avant v0.5 : énumération complète jusqu'à 6 dés (46 656 issues) → ~85 ms par appel,
     * soit plus d'une minute de page figée au Centre en fin de jeu.
     */
    const _avgCache = new Map();
    const _levelsSig = new WeakMap(); // évite un JSON.stringify à chaque appel
    const levelsSig = (lv) => { if (!lv || typeof lv !== 'object') return ''; let s = _levelsSig.get(lv); if (s === undefined) { s = JSON.stringify(lv); _levelsSig.set(lv, s); } return s; };
    function avgDamage(diceTypes, ctx) {
      const key = `${diceTypes.join(',')}|${ctx.attackerTypes}|${ctx.defTypes}|${levelsSig(ctx.levels)}`;
      const hit = _avgCache.get(key);
      if (hit !== undefined) return hit;
      let total = 0, count = 0;
      const cur = diceTypes.map((type) => ({ type, face: null }));
      if (spaceOf(diceTypes) <= CONFIG.exactEnumLimit) {
        const rec = (k) => {
          if (k === cur.length) { total += damage(cur, ctx).final; count++; return; }
          for (const f of facesOf(cur[k].type)) { cur[k].face = f; rec(k + 1); }
        };
        rec(0);
      } else {
        const rnd = seededRng(key);
        for (let s = 0; s < CONFIG.mcSamples; s++) {
          for (const c of cur) { const fs = facesOf(c.type); c.face = fs[(rnd() * fs.length) | 0]; }
          total += damage(cur, ctx).final; count++;
        }
      }
      const v = count ? total / count : 0;
      if (_avgCache.size > 20000) _avgCache.clear();
      _avgCache.set(key, v);
      return v;
    }

    const allLevels = (n) => ({ comboLevels: Object.fromEntries(COMBOS.map((c) => [c, n])), dieLevels: Object.fromEntries(Object.keys(D.dice).map((t) => [t, n])) });

    /**
     * Duel A contre B : >1 = A gagne la course aux K.O.
     * a/b = {stats (speciesAt), hp, levels}
     */
    function duelScore(a, b) {
      const aDmg = Math.max(0.1, avgDamage(a.stats.dice, { attackerTypes: a.stats.types, defTypes: b.stats.types, levels: a.levels }));
      const bDmg = Math.max(0.1, avgDamage(b.stats.dice, { attackerTypes: b.stats.types, defTypes: a.stats.types, levels: b.levels }));
      const turnsToKill = Math.ceil(b.hp / aDmg);
      const turnsToDie = Math.ceil(a.hp / bDmg);
      const speedEdge = a.stats.speed >= b.stats.speed ? 1.15 : 1;
      return { score: (turnsToDie / turnsToKill) * speedEdge, aDmg, bDmg, turnsToKill, turnsToDie };
    }

    return { speciesAt, eff, scaleEff, attackType, damage, statusesOf, utility, expectedUtility, chooseReroll, avgDamage, duelScore, combosIn, dieBonus, comboBonus, allLevels, faceVal, faceStatus, facesOf };
  };

  /* Tout ce qui suit nécessite le navigateur. En Node, on n'expose que l'Engine. */
  if (!IS_BROWSER) {
    root.PokeBot = { buildData, Engine, CONFIG, FALLBACK };
    if (typeof module !== 'undefined') module.exports = root.PokeBot;
    return;
  }

  /* ═════════════════════════════ 4. DOM & DONNÉES RUNTIME ═════════════════════════════ */
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  // getClientRects plutôt qu'offsetParent : ce dernier vaut null pour tout élément en position:fixed
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const enabled = (el) => !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const norm = (s) => (s || '').normalize('NFC').replace(/[▸▶]+/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Attend qu'une condition devienne vraie (sondage toutes les 30 ms) — remplace les pauses fixes. */
  async function waitFor(fn, timeout = 600) {
    const t0 = performance.now();
    for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > timeout) return null; await sleep(30); }
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const Rt = {
    D: buildData(null), E: null, i18n: new Map(), langIdx: 1,
    frNameToDex: new Map(), dexName: new Map(), itemNameToKey: new Map(), areaName: new Map(),
    areaLabel(a) { return this.areaName.get(norm(a?.name)) ?? a?.name ?? '?'; },

    async load() {
      try {
        const db = await new Promise((res, rej) => { const r = indexedDB.open('pokedice'); r.onsuccess = () => res(r.result); r.onerror = rej; });
        const rec = await new Promise((res) => { const r = db.transaction('content').objectStore('content').get('remote'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
        if (rec?.bundle?.diceTypes) this.D = buildData(rec.bundle);
      } catch (e) { console.warn('[PokéBot] IndexedDB indisponible, données de repli', e); }
      this.E = Engine(this.D);
      await this.loadI18n();
      log(`📦 données : ${this.D.source} · ${Object.keys(this.D.species).length} espèces · ${this.i18n.size} libellés`);
    },

    async loadI18n() {
      const save = readSave();
      this.langIdx = Math.max(0, LANGS.indexOf(save?.settings?.lang ?? document.documentElement.lang ?? 'fr'));
      try {
        const src = await (await fetch(document.querySelector('script[src*="/assets/index"]').src)).text();
        const lineRe = /\n((?:ui|item|pokemon|area)\.[\w.-]+),([^\n]*)/g;
        let m;
        while ((m = lineRe.exec(src))) {
          const cells = parseCsvLine(m[2]);
          const v = cells[this.langIdx] || cells[0];
          if (v) this.i18n.set(m[1], v);
          if (m[1].startsWith('pokemon.')) { const dex = +m[1].slice(8); this.frNameToDex.set(norm(v), dex); this.frNameToDex.set(norm(cells[0]), dex); this.dexName.set(dex, v); }
          if (m[1].startsWith('item.') && !m[1].includes('.desc')) this.itemNameToKey.set(norm(v), m[1].slice(5));
          if (m[1].startsWith('area.')) this.areaName.set(norm(cells[0]), v); // clé = nom anglais du bundle
        }
        // Groupes Œuf (Pension) : embarqués dans le bundle, pas dans IndexedDB — {1:{g:["Monster","Grass"]},…,{g:[…],s:"N",l:1}}
        const eg = {};
        for (const g of src.matchAll(/(\d+):\{g:\[([^\]]*)\](?:,s:"(\w)")?(?:,l:(\d))?\}/g)) {
          eg[+g[1]] = { g: g[2].split(',').map((x) => x.replace(/"/g, '')).filter(Boolean), ...(g[3] && { s: g[3] }), ...(g[4] && { l: +g[4] }) };
        }
        if (Object.keys(eg).length > 100) this.D.eggGroups = eg;
      } catch (e) { console.warn('[PokéBot] i18n indisponible', e); }
    },

    t(key, fallback) { return this.i18n.get(key) ?? fallback ?? key; },
    /** Regex d'un libellé i18n ({param} → .+). */
    re(key, fallback, { exact = false } = {}) {
      const tpl = norm(this.t(key, fallback));
      // Par défaut on tolère un suffixe (badge "Types de dés 2", "CONTINUER Manche 2 sur 2"…)
      return new RegExp('^' + tpl.split(/\{[^}]+\}/).map(esc).join('.+?') + (exact ? '$' : '(?:\\s.*)?$'));
    },
    dexOf(name) { return this.frNameToDex.get(norm(name)) ?? null; },
    nameOf(dex) { return this.dexName.get(dex) ?? this.D.species[dex]?.name ?? `#${dex}`; },
  };

  function parseCsvLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  }

  const readSave = () => { try { return JSON.parse(localStorage.getItem('pokedice.save')); } catch { return null; } };

  /** Bouton visible et actif dont le texte (ou aria-label) correspond à l'une des clés i18n. */
  function btn(keys, { scope = document, fallback } = {}) {
    const res = [].concat(keys).map((k) => Rt.re(k, fallback));
    return $$('button, a[role=button]', scope).find((b) => {
      if (!visible(b) || !enabled(b) || b.dataset.pokebot) return false;
      const t = norm(b.innerText) || norm(b.getAttribute('aria-label'));
      return res.some((r) => r.test(t));
    });
  }
  const bodyHas = (key) => { const head = norm(Rt.t(key)).split('{')[0].trim(); return !!head && norm(document.body.innerText).includes(head); };
  /** Comme bodyHas, pour un libellé qui COMMENCE par un paramètre ("{name} est capturé !") : test ligne par ligne. */
  const lineHas = (key) => { const re = Rt.re(key); return (document.body.innerText ?? '').split(/\r?\n/).some((l) => re.test(norm(l))); };
  const dialog = () => $$('[role=dialog]').find(visible) ?? null;
  const closeDialog = () => { const d = dialog(); const c = d?.querySelector('button[aria-label]'); const close = d && $$('button', d).find((b) => norm(b.getAttribute('aria-label')) === norm(Rt.t('ui.common.close', 'Fermer'))); (close ?? c)?.click(); return !!d; };
  const go = (href) => { const a = $$(`a[href="${href}"]`).find(visible); if (a) { a.click(); return true; } return false; };
  /** Retour à l'accueil même quand la barre du bas est masquée (écran de zone, fin de combat…). */
  const goHome = () => {
    if (go('/home')) return true;
    const b = btn(['ui.nav.home', 'ui.common.backHome'], { fallback: 'Accueil' });
    if (b) { b.click(); return true; }
    history.back(); return true;
  };
  /**
   * Bouton qui ouvre la liste des zones. Son libellé CHANGE selon l'état du jeu :
   * "Zones : changer de lieu…", "Zones, du nouveau : une zone secrète…", "Nouvelle région…",
   * ou la tuile "Prochaine zone secrète … Ouvrir la liste des zones". Avant v0.6 seul le 1er était reconnu.
   */
  function zonesButton() {
    const res = ['ui.home.areasLabel', 'ui.home.areasNew', 'ui.home.areasNewRegion'].map((k) => Rt.re(k));
    const head = norm(Rt.t('ui.home.areas', 'Zones'));
    const all = $$('button').filter((x) => visible(x) && !x.dataset.pokebot);
    const lab = (x) => norm(x.getAttribute('aria-label'));
    return all.find((x) => res.some((r) => r.test(lab(x))))
      ?? all.find((x) => lab(x).startsWith(head + ' :') || lab(x).startsWith(head + ',') || norm(x.innerText) === head)
      ?? all.find((x) => /ZONES\s*$/.test(lab(x)) && Rt.re('ui.home.secretNextLabel').test(lab(x)));
  }

  /** Pokémon d'équipe enrichis (stats, PV, niveaux d'amélioration). */
  function teamMons(save = readSave()) {
    if (!save) return [];
    const byId = Object.fromEntries(save.box.map((b) => [b.id, b]));
    return save.team.map((id) => byId[id]).filter(Boolean).map((m) => monView(m, save));
  }
  function boxMons(save = readSave()) {
    if (!save) return [];
    const inTeam = new Set(save.team);
    return save.box.filter((b) => !inTeam.has(b.id)).map((m) => monView(m, save));
  }
  function monView(m, save) {
    const stats = Rt.E.speciesAt(m.dex, m.level);
    return { id: m.id, dex: m.dex, name: Rt.nameOf(m.dex), level: m.level, hp: m.currentHp, stats, maxHp: stats?.maxHp ?? m.currentHp, levels: { comboLevels: save.comboLevels, dieLevels: save.dieLevels }, fossil: m.revivesAt != null };
  }
  /**
   * Espèces déjà obtenues : le Pokédex + les fossiles en train de revivre (instance avec `revivesAt`).
   * Un fossile n'entre au Pokédex qu'à son réveil (24 h) : sans ça, le mode Pokédex attendrait dans la zone.
   */
  function obtainedDex(save = readSave()) {
    const out = new Set(save?.pokedex ?? []);
    const all = [save?.box ?? [], ...Object.values(save?.parked ?? {}).map((p) => p?.box ?? [])].flat();
    for (const m of all) if (m?.revivesAt != null) out.add(m.dex);
    return out;
  }
  /** Espèces qu'on peut rencontrer dans une zone (comme le jeu : poids > 0 — les fossiles de la zone ont un poids nul). */
  const wildDexes = (area) => [...new Set((area?.wildPool ?? []).filter((w) => (w.weight ?? 1) > 0).map((w) => w.dex))].filter((d) => Rt.D.species[d]);
  const currentArea = (save = readSave()) => Rt.D.areas[save?.currentAreaId] ?? null;
  const enemyLevels = (area) => Rt.E.allLevels(area?.enemyUpgradeLevel ?? Rt.D.config.enemyUpgradeLevel ?? 1);

  /** Espèces probables d'une zone (pondérées), pour le Centre et les leads "à l'aveugle". */
  function areaThreats(area) {
    if (!area) return [];
    const lvl = Math.round(((area.minLevel ?? 5) + (area.maxLevel ?? 5)) / 2);
    const out = [];
    for (const w of area.wildPool ?? []) out.push({ dex: w.dex, level: Math.round((w.minLevel + w.maxLevel) / 2) || lvl, weight: w.weight ?? 1 });
    for (const tp of area.trainerPool ?? []) {
      const tr = Rt.D.trainers[tp.trainerId ?? tp.id];
      for (const tm of tr?.team ?? []) out.push({ dex: tm.dex, level: tm.level ?? lvl, weight: (tp.weight ?? 1) / Math.max(1, tr.team.length) });
    }
    for (const b of bossTeam(area)) out.push({ ...b, weight: 2 });
    return out.filter((x) => Rt.D.species[x.dex]);
  }

  /**
   * Dresseurs d'arène / Conseil / Maître d'une zone.
   * NB : `area.gyms` est une liste d'IDENTIFIANTS (chaînes) — avant v0.6 le bot lisait `g.trainerId`
   * et ignorait donc entièrement les équipes de boss.
   */
  const gymTrainers = (area) => (area?.gyms ?? [])
    .map((g) => Rt.D.trainers[typeof g === 'string' ? g : g?.trainerId ?? g?.id])
    .filter(Boolean);

  /** Équipe(s) que le bot devra battre pour terminer la zone (arène + légendaire), avec leurs niveaux réels. */
  function bossTeam(area) {
    if (!area) return [];
    const out = [];
    for (const tr of gymTrainers(area)) for (const m of tr.team ?? []) out.push({ dex: m.dex, level: m.level ?? area.maxLevel ?? 5, trainer: tr.name, upgradeLevel: tr.upgradeLevel });
    for (const b of area.legendaryBoss ?? []) out.push({ dex: b.dex, level: b.level ?? area.maxLevel ?? 5, trainer: 'légendaire' });
    return out.filter((x) => Rt.D.species[x.dex]);
  }

  /** Niveaux d'amélioration du boss (son propre upgradeLevel s'il en a un, sinon celui de la zone). */
  const bossLevels = (area, b) => Rt.E.allLevels(b?.upgradeLevel ?? area?.enemyUpgradeLevel ?? Rt.D.config.enemyUpgradeLevel ?? 1);

  /**
   * Analyse du duel équipe ↔ boss : pour chaque Pokémon du boss, le meilleur répondant de l'équipe.
   * @returns {{avg:number, worst:number, rows:{foe:string, level:number, best:string, score:number}[]}|null}
   */
  function bossMatchup(area, mons) {
    const boss = bossTeam(area);
    const ready = mons.filter((m) => m.stats && m.hp > 0);
    if (!boss.length || !ready.length) return null;
    const rows = boss.map((b) => {
      const st = Rt.E.speciesAt(b.dex, b.level);
      let best = null;
      for (const m of ready) {
        const s = Rt.E.duelScore({ stats: m.stats, hp: m.maxHp, levels: m.levels }, { stats: st, hp: st.maxHp, levels: bossLevels(area, b) }).score;
        if (!best || s > best.score) best = { best: m.name, score: s };
      }
      return { foe: Rt.nameOf(b.dex), level: b.level, ...best };
    });
    const scores = rows.map((r) => Math.min(4, r.score));
    return { avg: scores.reduce((a, b) => a + b, 0) / scores.length, worst: Math.min(...scores), rows };
  }

  /**
   * Regroupe les menaces par espèce (niveau moyen pondéré) et ne garde que les plus fréquentes.
   * Les zones avancées alignent des dizaines d'entrées (sauvages + dresseurs + arène) : sans ça,
   * le nombre de duels à simuler explose.
   */
  function compactThreats(threats, max = CONFIG.centerMaxThreats) {
    const byDex = new Map();
    for (const t of threats) {
      const cur = byDex.get(t.dex) ?? { dex: t.dex, w: 0, lw: 0 };
      cur.w += t.weight; cur.lw += t.level * t.weight;
      byDex.set(t.dex, cur);
    }
    return [...byDex.values()]
      .map((x) => ({ dex: x.dex, weight: x.w, level: Math.round(x.lw / (x.w || 1)), stats: Rt.E.speciesAt(x.dex, Math.round(x.lw / (x.w || 1))) }))
      .filter((x) => x.stats)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, max);
  }

  /** Score d'un Pokémon contre une liste de menaces (moyenne pondérée des duels). */
  function scoreVsThreats(mon, threats, area) {
    if (!mon.stats) return 0;
    if (!threats.length) return mon.level;
    const lv = enemyLevels(area);
    let s = 0, w = 0;
    for (const th of threats) {
      const st = th.stats ?? Rt.E.speciesAt(th.dex, th.level);
      if (!st) continue;
      const d = Rt.E.duelScore({ stats: mon.stats, hp: mon.maxHp, levels: mon.levels }, { stats: st, hp: st.maxHp, levels: lv });
      s += Math.min(4, d.score) * th.weight; w += th.weight;
    }
    return w ? s / w : 0;
  }

  /* ═════════════════════════════ 5. LECTURE DU COMBAT ═════════════════════════════ */
  function readBattle() {
    // Combat normal "Combat : X contre Y" ou combat de raid "Raid : X" (écran différent, plaques différentes)
    let raid = false;
    const region = $$('section[aria-label]').find((s) => Rt.re('ui.battle.heading').test(norm(s.getAttribute('aria-label'))))
      ?? $$('section[aria-label]').find((s) => (raid = Rt.re('ui.raid.heading').test(norm(s.getAttribute('aria-label')))));
    if (!region) return null;
    const label = (g) => g.getAttribute('aria-label') || '';
    const groups = $$('[role=group]', region);
    const yourDice = norm(Rt.t('ui.battle.yourDice', 'Tes dés'));
    const switchGroup = norm(Rt.t('ui.battle.switchGroup', 'Changer de Pokémon'));
    const ownRe = Rt.re('ui.battle.ownPlate');
    const allyRe = Rt.re('ui.raid.allyPlate'), bossRe = Rt.re('ui.raid.bossPlate');
    const you = norm(Rt.t('ui.raid.you', 'Toi'));
    const me = raid
      ? groups.find((g) => allyRe.test(norm(label(g))) && norm(g.textContent).split(' ').includes(you)) ?? groups.find((g) => allyRe.test(norm(label(g))))
      : groups.find((g) => ownRe.test(norm(label(g))));
    const diceGroup = groups.find((g) => norm(label(g)) === yourDice);
    const swGroup = groups.find((g) => norm(label(g)) === switchGroup);
    const foe = raid
      ? groups.find((g) => bossRe.test(norm(label(g))))
      : groups.find((g) => g !== me && g !== diceGroup && g !== swGroup && /,/.test(label(g)));

    // Adversaire : "Roucool, N.3" → espèce + niveau → stats
    const [foeName, foeLvlTxt] = label(foe ?? { getAttribute: () => '' }).split(',');
    const foeLevel = +(foeLvlTxt?.match(/\d+/)?.[0] ?? 0);
    const foeDex = Rt.dexOf(foeName?.trim() ?? '');
    const foeStats = foeDex ? Rt.E.speciesAt(foeDex, foeLevel || 1) : null;
    const foePct = +(foe?.querySelector('[role=meter]')?.getAttribute('aria-valuenow') ?? 100);
    const foeTypesShown = foe ? $$('*', foe).filter((e) => !e.children.length).map((e) => typeFromLabel(e.innerText)).filter(Boolean) : [];
    const foeTypes = foeStats?.types ?? foeTypesShown;

    // Moi : nom via la plaque "Ton X, N.y", PV via la jauge
    // Raid : la plaque est "{name} de {owner}, {level}" ; le nom est aussi en gras dans la plaque
    const myName = raid
      ? (me?.querySelector('b')?.textContent.trim() ?? label(me ?? { getAttribute: () => '' }).split(',')[0].trim())
      : label(me ?? { getAttribute: () => '' }).replace(new RegExp('^' + esc(norm(Rt.t('ui.battle.ownPlate')).split('{')[0]), 'i'), '').split(',')[0].trim()
        || label(me ?? { getAttribute: () => '' }).replace(/^Ton\s+/i, '').split(',')[0].trim();
    const myLvl = +(label(me ?? { getAttribute: () => '' }).match(/(\d+)\s*$/)?.[1] ?? 0);
    const meter = me?.querySelector('[role=meter]');
    const myHp = +(meter?.getAttribute('aria-valuenow') ?? 0), myMax = +(meter?.getAttribute('aria-valuemax') ?? 1);
    const myDex = Rt.dexOf(myName);
    const myStats = myDex ? Rt.E.speciesAt(myDex, myLvl || 1) : null;

    const dice = diceGroup ? $$('button[aria-label]', diceGroup).map(parseDie).filter(Boolean) : [];
    const rerollRe = Rt.re('ui.battle.reroll');
    const rerollBtn = $$('button', region).find((b) => rerollRe.test(norm(b.innerText)));
    const rerollsLeft = +(rerollBtn?.innerText.match(/\d+/)?.[0] ?? 0);
    const attackBtn = btn('ui.battle.attack', { scope: region });
    const bagBtn = btn('ui.battle.bag', { scope: region });
    const skipTurnBtn = btn('ui.battle.skipTurn', { scope: region });
    const shownDmg = +(region.querySelector('button[aria-label*="—"]')?.getAttribute('aria-label').match(/^\d+/)?.[0] ?? NaN);
    const switchBtns = swGroup ? $$('button', swGroup) : [];
    const isTrainer = !Rt.re('ui.battle.heading').test(norm(region.getAttribute('aria-label'))) ? false : !/sauvage|wild/i.test(region.getAttribute('aria-label'));

    const save = readSave();
    const area = currentArea(save);
    // Raid : améliorations et échelles de type imposées par le raid ; chaque barre du boss vaut barHp × PV max
    const levels = raid ? raidSideLevels() : { comboLevels: save?.comboLevels ?? {}, dieLevels: save?.dieLevels ?? {} };
    const foeMax = foeStats?.maxHp ? Math.round(foeStats.maxHp * (raid ? raidCfg()?.barHp ?? 1 : 1)) : null;
    const foeHp = foeMax ? Math.max(1, Math.ceil(foeMax * foePct / 100)) : Infinity;
    const foeExpDmg = foeStats && myStats ? Rt.E.avgDamage(foeStats.dice, { attackerTypes: foeStats.types, defTypes: myStats.types, levels: raid ? raidBossLevels() : enemyLevels(area) }) : 0.15 * myMax;
    const myExpDmg = myStats ? Rt.E.avgDamage(myStats.dice, { attackerTypes: myStats.types, defTypes: foeTypes, levels }) : 5;

    return {
      region, dice, rerollsLeft, rerollBtn, attackBtn, bagBtn, skipTurnBtn, shownDmg, switchBtns, isTrainer,
      ctx: {
        attackerTypes: myStats?.types ?? [], defTypes: foeTypes, levels,
        foe: { name: foeName?.trim(), dex: foeDex, hp: foeHp, maxHp: foeMax ?? 50, pct: foePct, expDmg: foeExpDmg, stats: foeStats },
        me: { name: myName, dex: myDex, hp: myHp, maxHp: myMax, expDmg: myExpDmg, stats: myStats },
      },
    };
  }

  function typeFromLabel(txt) {
    const t = norm(txt);
    if (!t) return null;
    for (const type of Object.keys(Rt.D.dice)) if (norm(Rt.t('ui.type.' + type, type)) === t) return type;
    return null;
  }

  function parseDie(el) {
    // "Dé Plante, 4" | "Dé Plante, Soin (3)"  (gabarit ui.die.withFace)
    const m = (el.getAttribute('aria-label') || '').match(/^(.+?),\s*(.+)$/);
    if (!m) return null;
    const typeTxt = m[1].replace(new RegExp('^' + esc(Rt.t('ui.die.name', 'Dé {type}').split('{')[0]), 'i'), '').replace(/die$/i, '').trim();
    const type = typeFromLabel(typeTxt) ?? (norm(typeTxt) === 'BASE' ? 'base' : 'base');
    const raw = m[2];
    const faces = Rt.E.facesOf(type);
    const num = +(raw.match(/\d+/)?.[0] ?? NaN);
    const statusKey = ['burn', 'poison', 'frozen', 'paralyze', 'confuse', 'heal'].find((s) => norm(raw).includes(norm(Rt.t(`ui.status.${s}.name`, s))));
    const face = statusKey
      ? faces.find((f) => f.kind === 'status' && f.status === statusKey) ?? { kind: 'status', status: statusKey, value: num || 0 }
      : faces.find((f) => f.kind === 'number' && f.value === num) ?? { kind: 'number', value: Number.isNaN(num) ? 0 : num };
    return { el, type, face, label: el.getAttribute('aria-label'), selected: el.getAttribute('aria-pressed') === 'true' };
  }

  /* ═════════════════════════════ 6. POLICIES ═════════════════════════════ */
  const journal = [];
  function log(...a) {
    const line = `${new Date().toLocaleTimeString()} ${a.join(' ')}`;
    journal.push(line); if (journal.length > 800) journal.shift();
    if (CONFIG.debug) console.log('%c[PokéBot]', 'color:#e5533d;font-weight:bold', ...a);
    ui.status(a.join(' '));
  }
  const fmt = (dice) => dice.map((d) => `${d.type}:${Rt.E.faceVal(d.face)}${d.face.kind === 'status' ? '*' : ''}`).join(' ');

  const mem = { itemTurn: null, cureTurn: null, megaUsed: false, lastChoresGold: -1, choresStep: null, centerDone: null, switchedFor: null, travelFail: new Set(), rare: null, bossFight: null, bossLogSig: null, trainee: null };

  /* ── 6.1 Objets en combat (soin, statuts, Huile) ── */
  const itemName = (key) => norm(Rt.t('item.' + key, Rt.D.items[key]?.name ?? key));
  async function useItem(b, key, targetName) {
    if (!b.bagBtn) return false;
    b.bagBtn.click();
    const d = await waitFor(dialog);
    const it = d && $$('button', d).find((x) => enabled(x) && norm(x.innerText).startsWith(itemName(key)));
    if (!it) { closeDialog(); return false; }
    it.click();
    await waitFor(() => { const x = dialog(); return x && (x !== d || Rt.re('ui.battle.useItemOn').test(norm(x.innerText.split('\n')[0]))) ? x : null; }, 500);
    const d2 = dialog();
    if (d2 && Rt.re('ui.battle.useItemOn').test(norm(d2.innerText.split('\n')[0]))) {
      const target = $$('button', d2).find((x) => enabled(x) && norm(x.innerText).startsWith(norm(targetName)));
      if (target) { target.click(); await sleep(150); }
    }
    closeDialog(); await sleep(150); closeDialog();
    return true;
  }

  const inv = () => readSave()?.inventory ?? {};
  const itemsOfKind = (kind) => Object.entries(inv()).filter(([k, n]) => n > 0 && Rt.D.items[k]?.effect?.kind === kind).map(([k, n]) => ({ key: k, n, ...Rt.D.items[k].effect }));

  /**
   * Faut-il soigner ? Le Centre de début de manche soigne gratuitement : contre un sauvage,
   * une potion n'est utile que si un K.O. met vraiment l'équipe en péril.
   */
  function shouldHeal(me, foe, team = null) {
    const danger = foe.expDmg * CONFIG.dangerMargin >= me.hp;
    const low = me.hp / me.maxHp < CONFIG.potionBelowHpRatio;
    const important = (mem.fightKind && mem.fightKind !== 'wild') || !!mem.rare;
    if (CONFIG.healPolicy === 'safe') return danger || low;
    if (CONFIG.healPolicy === 'normal') return danger || (low && important);
    if (!danger) return false;
    if (important) return true;
    const mons = team ?? teamMons();
    const others = mons.filter((m) => m.hp > 0 && norm(m.name) !== norm(me.name));
    const total = mons.reduce((n, m) => n + (m.maxHp || 0), 0) || 1;
    return others.reduce((n, m) => n + m.hp, 0) / total < CONFIG.ecoBackupRatio;
  }
  /** Le plus petit soin qui permet d'encaisser ~2 coups (ou rend 40 % de ce qui manque) ; sinon le plus gros. */
  function pickHeal(heals, me, foe) {
    const missing = me.maxHp - me.hp;
    const want = Math.min(missing, Math.max(foe.expDmg * CONFIG.dangerMargin * 2 - me.hp, missing * 0.4));
    return heals.find((h) => h.amount >= want) ?? heals.at(-1);
  }

  async function battleItems(b) {
    const { me, foe } = b.ctx;
    const turn = `${b.dice.map((d) => d.label).join('|')}@${me.hp}`;
    if (mem.itemTurn === turn) return false; // un objet par tour (et on ne re-teste pas le même tour)

    // a) Soins de statut : on n'a pas de lecture fiable du statut → on regarde dans le Sac si un remède est ACTIF
    const cures = itemsOfKind('cure');
    if (cures.length && mem.cureTurn !== turn && b.bagBtn) {
      mem.cureTurn = turn;
      b.bagBtn.click(); await waitFor(dialog);
      const d = dialog();
      const usable = d ? cures.filter((c) => $$('button', d).some((x) => enabled(x) && norm(x.innerText).startsWith(itemName(c.key)))) : [];
      closeDialog(); await sleep(200);
      const stun = usable.find((c) => c.statuses?.some((s) => s === 'paralyze' || s === 'frozen'));
      const dot = usable.find((c) => c.statuses?.some((s) => s === 'burn' || s === 'poison'));
      const pick = stun ?? (dot && me.hp / me.maxHp < CONFIG.cureBurnPoisonBelow ? dot : null);
      if (pick) { mem.itemTurn = turn; log(`💊 remède ${Rt.t('item.' + pick.key)} sur ${me.name}`); return useItem(b, pick.key, me.name); }
    }

    // b) Soin PV : en danger (la prochaine attaque peut me sortir) ou sous le seuil, et je ne tue pas ce tour-ci
    const killNow = Number.isFinite(b.shownDmg) && b.shownDmg >= foe.hp;
    if (!killNow && me.hp < me.maxHp && shouldHeal(me, foe)) {
      const heals = itemsOfKind('heal').sort((a, c) => a.amount - c.amount);
      if (!heals.length && mem.noHealLog !== foe.name) { mem.noHealLog = foe.name; log(`🚫 plus aucun soin dans le Sac (${me.name} ${me.hp}/${me.maxHp} PV) — la boutique en rachètera`); }
      if (heals.length) {
        const pick = pickHeal(heals, me, foe);
        mem.itemTurn = turn;
        log(`💊 ${Rt.t('item.' + pick.key)} sur ${me.name} (${me.hp}/${me.maxHp} PV, menace ≈ ${foe.expDmg.toFixed(1)}, ${mem.fightKind ?? 'combat'})`);
        return useItem(b, pick.key, me.name);
      }
    }

    // c) Huile : plus de relance et un gros gain possible
    if (b.rerollsLeft === 0 && !killNow) {
      const ethers = itemsOfKind('rerolls').sort((a, c) => a.amount - c.amount);
      if (ethers.length) {
        const c = Rt.E.chooseReroll(b.dice, b.ctx, { ...CONFIG, rerollMinGainRatio: 0.3, rerollMinGain: 4 });
        if (c.idx) { mem.itemTurn = turn; log(`🧪 ${Rt.t('item.' + ethers[0].key)} (gain espéré +${c.gain.toFixed(1)})`); return useItem(b, ethers[0].key, me.name); }
      }
    }
    mem.itemTurn = turn;
    return false;
  }

  /* ── 6.2 Tour de combat ── */
  /** Modale ouverte par NOTRE Sac (à refermer) — à distinguer de VICTOIRE, capture, etc. */
  function isBagDialog(d) {
    const head = norm(d?.innerText.split('\n')[0]);
    return ['ui.battle.itemsTitle', 'ui.battle.useItemOn', 'ui.itemPanel.title'].some((k) => Rt.re(k).test(head));
  }

  /**
   * Changement volontaire en combat quand le duel est très défavorable (coûte le tour,
   * donc le remplaçant est évalué après avoir encaissé un coup). Un seul par adversaire.
   */
  function voluntarySwitch(b) {
    if (!Rt.D.config.allowVoluntarySwitch || !b.ctx.foe.stats || !b.ctx.me.stats) return null;
    const key = `${b.ctx.foe.dex}@${b.ctx.foe.maxHp}`;
    if (mem.switchedFor === key) return null;
    const foe = { stats: b.ctx.foe.stats, hp: b.ctx.foe.hp, levels: enemyLevels(currentArea()) };
    const team = teamMons();
    const cur = team.find((m) => norm(m.name) === norm(b.ctx.me.name));
    if (!cur) return null;
    const curS = Rt.E.duelScore({ stats: cur.stats, hp: b.ctx.me.hp, levels: cur.levels }, foe).score;
    // Dresseur / arène / boss : à chaque nouveau Pokémon adverse, on vérifie le match-up (faiblesse / résistance)
    const important = mem.fightKind && mem.fightKind !== 'wild';
    const effOn = (atkStats, defStats) => Math.max(...[...new Set(atkStats.dice.filter((t) => t !== 'base'))].map((t) => Rt.E.eff(t, defStats.types)), 1);
    const weak = effOn(foe.stats, cur.stats) >= 2;            // il nous touche en super efficace
    const gate = important && CONFIG.switchOnNewFoe ? (curS < CONFIG.switchBelow || (weak && curS < CONFIG.switchBelow * 1.3)) : curS < 0.6;
    if (!gate) return null;
    let best = null;
    for (const el of b.switchBtns) {
      if (!enabled(el)) continue;
      const name = (el.getAttribute('aria-label') || '').split(',')[0].trim();
      const m = team.find((x) => norm(x.name) === norm(name) && x.hp > 0);
      if (!m || m.id === cur.id) continue;
      const s = Rt.E.duelScore({ stats: m.stats, hp: Math.max(1, m.hp - b.ctx.foe.expDmg), levels: m.levels }, foe).score;
      if (!best || s > best.s) best = { el, s, name, cur: curS };
    }
    const need = important && CONFIG.switchOnNewFoe ? Math.max(1.1, curS * CONFIG.switchGain) : Math.max(1, curS * 2);
    if (best && best.s > need) {
      mem.switchedFor = key;
      const m = team.find((x) => norm(x.name) === norm(best.name));
      best.why = weak ? `${cur.name} est faible contre ${b.ctx.foe.name}` : `${cur.name} perd le duel contre ${b.ctx.foe.name}`;
      if (m?.stats && effOn(foe.stats, m.stats) < 1) best.why += `, ${best.name} résiste`;
      return best;
    }
    mem.switchedFor = key; // évalué pour cet adversaire : pas de nouvelle tentative
    return null;
  }

  async function playBattle(b) {
    // Pas notre tour, ou un écran (VICTOIRE, capture…) recouvre la section combat → on laisse la main.
    if (!b.attackBtn && !b.skipTurnBtn) return false;
    const d = dialog();
    if (d) { if (isBagDialog(d)) { closeDialog(); return true; } return false; }

    if (b.attackBtn) {
      const sw = voluntarySwitch(b);
      if (sw) { log(`🔄 changement : ${sw.name} (${sw.why ?? 'meilleur duel'} — duel ${sw.s.toFixed(2)} contre ${sw.cur.toFixed(2)})`); sw.el.click(); await sleep(400); return true; }
    }

    // Méga-Évolution : une fois par combat, dès que possible
    const mega = btn(['ui.battle.mega', 'ui.battle.gmax', 'ui.battle.primal', 'ui.battle.ultra'], { scope: b.region });
    if (mega && !mem.megaUsed) {
      mem.megaUsed = true; mega.click(); await sleep(500);
      const d = dialog();
      const opt = d && $$('button', d).find((x) => enabled(x) && !x.getAttribute('aria-label'));
      if (opt) { log('✨ Méga-Évolution'); opt.click(); await sleep(400); }
      closeDialog();
      return true;
    }

    // Pokémon étourdi : remède si possible, sinon passer le tour
    if (!b.attackBtn && b.skipTurnBtn) {
      if (await battleItems(b)) return true;
      log('😵 tour passé (étourdi)'); b.skipTurnBtn.click(); return true;
    }
    if (!b.attackBtn || !b.dice.length) return false;

    if (b.dice.some((d) => d.selected)) { b.dice.filter((d) => d.selected).forEach((d) => d.el.click()); return true; }

    if (await battleItems(b)) return true;

    if (b.rerollsLeft > 0) {
      const c = Rt.E.chooseReroll(b.dice, b.ctx);
      if (c.idx) {
        log(`🎲 relance [${c.idx}] ${fmt(b.dice)} : ${c.base.toFixed(1)} → EV ${c.ev.toFixed(1)} (reste ${b.rerollsLeft})`);
        c.idx.forEach((i) => b.dice[i].el.click());
        // le bouton RELANCER s'active dès que la sélection est prise en compte
        if (b.rerollBtn && (await waitFor(() => enabled(b.rerollBtn), 400))) b.rerollBtn.click();
        return true;
      }
    }
    const u = Rt.E.utility(b.dice, b.ctx);
    const flag = Number.isFinite(b.shownDmg) && b.shownDmg !== u.dmg.final ? ` ⚠️ modèle ${u.dmg.final}` : '';
    const extra = [u.kill && 'K.O.', ...Object.keys(u.st)].filter(Boolean).join(',');
    log(`⚔️ ${fmt(b.dice)} → ${b.shownDmg} dégâts${flag} vs ${b.ctx.foe.name} (${b.ctx.foe.hp}/${b.ctx.foe.maxHp})${extra ? ' [' + extra + ']' : ''}`);
    b.attackBtn.click();
    noteTurn();
    return true;
  }

  /** Chronomètre : durée moyenne d'un tour (attaque → attaque suivante du même combat), affichée tous les 10 tours. */
  function noteTurn() {
    const now = Date.now();
    if (mem.lastAttackAt && now - mem.lastAttackAt < 30000) (mem.turnMs ??= []).push(now - mem.lastAttackAt);
    mem.lastAttackAt = now;
    if (mem.turnMs?.length >= 10) {
      const ms = mem.turnMs.splice(0).sort((a, b) => a - b);
      log(`⏱️ tour médian : ${(ms[ms.length >> 1] / 1000).toFixed(1)} s (min ${(ms[0] / 1000).toFixed(1)} s)`);
    }
  }

  /**
   * Règle "Animations : Courtes" du jeu (option joueur standard, menu Réglages).
   * Le jeu lit ce réglage au chargement : il prend effet au prochain rechargement de la page.
   * NB : "Aucune animation" est réservé aux admins par le jeu → le bot n'y touche pas.
   */
  function applyShortAnimations() {
    if (!CONFIG.shortAnimations) return;
    try {
      const cur = JSON.parse(localStorage.getItem('pokedice.settings') || 'null') ?? readSave()?.settings ?? {};
      if (cur.animations === 'short') return;
      localStorage.setItem('pokedice.settings', JSON.stringify({ ...cur, animations: 'short' }));
      log('🎬 réglage du jeu "Animations : Courtes" activé — effectif au prochain rechargement de la page');
    } catch {}
  }

  /** Remplaçant après K.O. : meilleur duel contre l'adversaire actuel. */
  function pickReplacement() {
    if (!bodyHas('ui.battle.chooseNext')) return null;
    const b = readBattle();
    const team = teamMons();
    const cands = $$('button').filter((x) => visible(x) && enabled(x) && /\d+\s*\/\s*\d+/.test(x.innerText));
    let best = null;
    for (const el of cands) {
      const name = el.innerText.split('\n')[0].trim();
      const mon = team.find((m) => norm(m.name) === norm(name) && m.hp > 0);
      if (!mon) continue;
      const s = b?.ctx.foe.stats ? Rt.E.duelScore({ stats: mon.stats, hp: mon.hp, levels: mon.levels }, { stats: b.ctx.foe.stats, hp: b.ctx.foe.hp, levels: enemyLevels(currentArea()) }).score : mon.hp;
      if (!best || s > best.s) best = { el, s, name };
    }
    return best;
  }

  /* ── 6.3 Avant le combat (écran de rencontre) ── */
  function encounterKind() {
    for (const k of ['titleWild', 'titleBoss', 'titleTrainer', 'titleGym', 'titleItem', 'titleCenter', 'titleCasino', 'titleTrick']) if (bodyHas('ui.enc.' + k)) return k.slice(5).toLowerCase();
    return null;
  }

  /** La carte de rencontre est une modale : on lit son texte (repli : <main>). */
  const encounterText = () => (dialog() ?? document.querySelector('main'))?.innerText ?? '';

  /** Lit l'adversaire affiché sur la carte de rencontre (nom connu + premier "N.x"). */
  function encounterFoe() {
    const txt = encounterText();
    const sendOut = Rt.t('ui.lead.sendOut', 'Envoyer :').replace(/\s*:\s*$/, '');
    const head = txt.split(sendOut)[0];
    for (const line of head.split('\n')) {
      const dex = Rt.dexOf(line.trim());
      if (dex) { const lv = +(head.slice(head.indexOf(line)).match(/N\.\s*(\d+)|Lv\.\s*(\d+)/)?.slice(1).find(Boolean) ?? 5); return { dex, level: lv, stats: Rt.E.speciesAt(dex, lv) }; }
    }
    return null;
  }

  async function playEncounter(kind) {
    mem.encounterPending = null;
    if (kind === 'wild' || kind === 'trainer') noteDexProgress(); // on traite la rencontre : le changement de zone redeviendra possible ensuite
    const save = readSave();
    const area = currentArea(save);
    if (kind === 'item') { const p = btn('ui.enc.pickUp'); if (p) { log('🎒 ramasse'); p.click(); return true; } }
    if (kind === 'casino') {
      // Carte de rencontre : on n'entre pas (machine à sous payante) ; si on est dedans : PARTIR
      const s = btn(['ui.casino.leave', 'ui.enc.skip', 'ui.enc.notYet']);
      if (s) { log('↷ Casino : on passe'); s.click(); return true; }
    }
    if (kind === 'trick') return playTrick();
    if (kind === 'center') {
      const hurt = teamMons(save).some((m) => m.hp < m.maxHp);
      const e = btn('ui.enc.enter'), s = btn('ui.enc.skip');
      const choice = (hurt || CONFIG.manageTeam) && e ? e : s ?? e;
      if (choice) { log(`🏥 Centre : ${choice === e ? 'on entre' : 'passé'}`); choice.click(); return true; }
    }

    const team = teamMons(save).filter((m) => m.hp > 0 && m.stats);
    const foe = encounterFoe();
    const lv = enemyLevels(area);
    const threats = foe ? [{ dex: foe.dex, level: foe.level, weight: 1 }] : compactThreats(areaThreats(area));
    const scored = team.map((m) => ({ m, s: foe?.stats
      ? Rt.E.duelScore({ stats: m.stats, hp: m.hp, levels: m.levels }, { stats: foe.stats, hp: foe.stats.maxHp, levels: lv }).score
      : scoreVsThreats({ ...m, maxHp: m.hp }, threats, area) })).sort((a, b) => b.s - a.s);

    // Choix du meneur. Après CHANGER, chaque carte a un bouton aria-label "Envoyer {nom}" (aria-pressed = choisi).
    const sendRe = Rt.re('ui.lead.sendOutName', 'Envoyer {name}', { exact: true });
    const sendBtns = $$('button[aria-label]', dialog() ?? document).filter((x) => visible(x) && sendRe.test(norm(x.getAttribute('aria-label'))));
    const pressedName = sendBtns.find((x) => x.getAttribute('aria-pressed') === 'true')?.getAttribute('aria-label');
    const sendOutRe = new RegExp(esc(norm(Rt.t('ui.lead.sendOut', 'Envoyer :'))) + '\\s*(.+?)\\s+N\\.', 'i');
    const curName = pressedName ? norm(pressedName).replace(norm(Rt.t('ui.lead.sendOutName', 'Envoyer {name}')).split('{')[0], '').trim() : norm(encounterText()).match(sendOutRe)?.[1];
    const cur = scored.find((x) => norm(x.m.name) === curName) ?? scored.find((x) => x.m.id === teamMons(save)[0]?.id);
    // Meneur : le plus fort, sauf s'il faut faire monter quelqu'un et que c'est sans risque
    // (Pokémon en formation pour un boss, ou le moins haut niveau en mode Farm / trainWeakest).
    const safe = scored.filter((x) => x.s >= CONFIG.trainMinScore);
    const trainee = mem.trainee && safe.find((x) => x.m.id === mem.trainee);
    const weakest = CONFIG.trainWeakest && [...safe].sort((a, b) => a.m.level - b.m.level)[0];
    // XP utile : parmi les meneurs sans risque, celui qui fait gagner le plus d'XP à l'équipe (Multi Exp compris).
    // Un porteur au niveau max mène si les élèves derrière lui prennent 100 % ; sinon un élève sûr peut mener.
    const xpBest = CONFIG.xpLead && !CONFIG.trainWeakest && (kind === 'wild' || kind === 'trainer') && safe.length
      ? [...safe].sort((a, b) => usefulXp(b.m, team, save) - usefulXp(a.m, team, save) || b.s - a.s)[0] : null;
    const best = weakest || (xpBest && usefulXp(xpBest.m, team, save) > usefulXp(scored[0].m, team, save) ? xpBest : null) || trainee || scored[0];
    if (best !== scored[0] && CONFIG.debug) mem.trainingNote = `🎓 ${best.m.name} N.${best.m.level} mène pour l'XP (duel ${best.s.toFixed(2)})`;
    const training = best !== scored[0]; // meneur choisi pour l'XP : le gain de score n'est pas le critère
    if (CONFIG.manageLead && best && cur && best.m.id !== cur.m.id && (training || best.s > cur.s * CONFIG.leadSwitchGain)) {
      const target = sendBtns.find((x) => norm(x.getAttribute('aria-label')).endsWith(norm(best.m.name)));
      if (target) {
        log(training ? mem.trainingNote ?? `🎓 ${best.m.name} mène pour l'XP` : `🔀 meneur : ${best.m.name} (${best.s.toFixed(2)}) au lieu de ${cur.m.name} (${cur.s.toFixed(2)})`);
        target.click(); await sleep(350);
        return true;
      }
      const sw = btn('ui.lead.switch', { scope: dialog() ?? document });
      if (sw && !sendBtns.length) { sw.click(); await sleep(400); return true; } // déplie la liste
    }

    // Combattre, fuir ou éviter
    const bestS = best?.s ?? 0;
    const isNew = bodyHas('ui.enc.new') || (foe && !(save?.pokedex ?? []).includes(foe.dex));
    const isShiny = bodyHas('ui.enc.shinyExtra') || norm(encounterText()).includes(norm(Rt.t('ui.victory.shinyPrefix', 'Chromatique')));
    // Retenu pour l'écran de capture : on y mettra la meilleure Ball
    mem.rare = (isNew || isShiny || kind === 'boss') ? { dex: foe?.dex, why: isShiny ? 'chromatique' : kind === 'boss' ? 'légendaire' : 'nouvelle espèce' } : null;
    if (isShiny) { log(`✨ CHROMATIQUE : ${foe ? Rt.nameOf(foe.dex) : '?'} !`); Stats.add('shinySeen'); notify('Chromatique !', foe ? Rt.nameOf(foe.dex) : ''); }
    else if (kind === 'boss' && mem.legendNote !== foe?.dex) { mem.legendNote = foe?.dex; notify('Légendaire en vue', foe ? Rt.nameOf(foe.dex) : ''); }

    if (kind === 'wild' && bestS < CONFIG.fleeIfBestScoreBelow && !isNew && !isShiny) { const f = btn('ui.enc.flee'); if (f) { log(`🏃 fuite (meilleur score ${bestS.toFixed(2)})`); Ledger.encounter(); f.click(); return true; } }
    // Mode Pokédex : pas besoin d'XP ni de captures en double → on ne perd pas de temps sur les espèces connues
    const inTraining = !!mem.trainee || teamMons(save).some((m) => mem.xpTrainees?.includes(m.id) && m.level < maxLevel());
    if (CONFIG.mode === 'pokedex' && CONFIG.dexFocus !== 'evo' && kind === 'wild' && !isNew && !isShiny && !inTraining && avg(topLevels(teamMons(save))) >= (area?.maxLevel ?? 0) + CONFIG.pokedexFleeKnownMargin) {
      const f = btn('ui.enc.flee'); if (f) { log(`🏃 déjà au Pokédex : ${foe ? Rt.nameOf(foe.dex) : '?'} (fuite)`); Ledger.encounter(); f.click(); return true; }
    }
    if (kind === 'trainer' && bestS < CONFIG.avoidTrainerIfBelow && !(CONFIG.mode === 'farm' && CONFIG.farmGoal === 'gold' && bestS >= CONFIG.avoidTrainerIfBelow * 0.7)) { const a = btn('ui.enc.avoid'); if (a) { log(`🙈 dresseur évité (score ${bestS.toFixed(2)})`); a.click(); return true; } }
    if ((kind === 'boss' || kind === 'gym') && mem.errand !== 'rebattle' && !teamReadyForBoss(area)) {
      const n = btn(['ui.enc.notYet', 'ui.enc.avoid', 'ui.enc.skip']);
      if (n) { log(`⏳ ${kind === 'gym' ? 'arène' : 'légendaire'} : pas encore, on s'entraîne`); n.click(); return true; }
    }
    if ((kind === 'boss' || kind === 'gym') && mem.errand !== 'rebattle') noteBossFight(area);
    const fight = btn(['ui.enc.fight', 'ui.area.faceIt']);
    if (fight) { mem.megaUsed = false; mem.fightKind = kind; Ledger.encounter(); log(`⚔️ rencontre ${kind}${foe ? ' : ' + Rt.nameOf(foe.dex) + ' N.' + foe.level : ''} — meneur ${cur?.m.name ?? '?'} (${(cur?.s ?? 0).toFixed(2)})`); fight.click(); return true; }
    return false;
  }

  /**
   * « Un bonbon ou un sort » (événement) : Friandises et Farce Balls sont gratuites.
   * Friandise tant que la Farce Ball a < 50 % de chance, sinon Farce Ball.
   */
  async function playTrick() {
    const start = btn(['ui.trick.start', 'ui.enc.enter', 'ui.common.continue']);
    const ballBtn = $$('button').find((x) => visible(x) && enabled(x) && norm(x.innerText).startsWith(norm(Rt.t('ui.trick.ball', 'Farce Ball'))));
    const treatBtn = $$('button').find((x) => visible(x) && enabled(x) && norm(x.innerText).startsWith(norm(Rt.t('ui.trick.treat', 'Friandise'))));
    if (ballBtn || treatBtn) {
      const pct = +(norm(ballBtn?.innerText ?? '').match(/(\d+)\s*%/)?.[1] ?? 0);
      const pick = !treatBtn || (ballBtn && pct >= 50) ? ballBtn : treatBtn;
      log(`🍬 bonbon ou sort : ${pick === ballBtn ? 'Farce Ball (' + pct + ' %)' : 'Friandise'}`);
      pick.click();
      return true;
    }
    if (start) { start.click(); return true; }
    const skip = btn(['ui.enc.skip', 'ui.enc.notYet']);
    if (skip) { skip.click(); return true; }
    return false;
  }

  /* ── 6.4 Boss / progression ── */
  const topLevels = (mons) => mons.map((m) => m.level).sort((a, b) => b - a).slice(0, Rt.D.config.maxTeamSize ?? 3);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  /**
   * Prêt à défier ? Avec l'équipe réelle du boss : chaque Pokémon adverse doit avoir un répondant
   * (duel ≥ bossWorstScore) et la moyenne doit atteindre bossReadyScore, relevé après chaque défaite.
   * Sans données de boss : ancienne règle (niveau max de la zone / manches en plus).
   */
  function teamReadyForBoss(area, save = readSave(), { quiet = false } = {}) {
    if (!area) return true;
    const fails = bossFails(area.id);
    const mu = bossMatchup(area, teamMons(save));
    if (mu) {
      const need = CONFIG.bossReadyScore * (1 + CONFIG.bossFailMargin * fails);
      const ok = mu.avg >= need && mu.worst >= CONFIG.bossWorstScore;
      const sig = `${area.id}|${ok}|${mu.avg.toFixed(1)}`;
      if (!quiet && mem.bossLogSig !== sig) {
        mem.bossLogSig = sig;
        const weak = mu.rows.filter((r) => r.score < Math.max(1, need)).map((r) => `${r.foe} N.${r.level} (${r.best} ${r.score.toFixed(2)})`).join(', ');
        log(ok ? `✅ prêt pour le boss : moyenne ${mu.avg.toFixed(2)} ≥ ${need.toFixed(2)}` : `🛡️ pas prêt pour le boss (${fails} défaite${fails > 1 ? 's' : ''}) : moyenne ${mu.avg.toFixed(2)} / ${need.toFixed(2)} — à travailler : ${weak}`);
      }
      return ok;
    }
    const lv = avg(topLevels(teamMons(save)));
    const extra = (save?.areaProgress?.[area.id]?.roundsDone ?? 0) - (area.roundsToClear ?? 0);
    return lv >= (area.maxLevel ?? 0) + CONFIG.bossLevelMargin + 2 * fails || (extra >= CONFIG.maxExtraRounds * (1 + fails) && !fails);
  }

  /** Défaites contre le boss d'une zone (mémorisées : survivent au rechargement). */
  const BOSS_KEY = 'pokebot.bossFails';
  const bossFails = (areaId) => { try { return JSON.parse(localStorage.getItem(BOSS_KEY))?.[areaId] ?? 0; } catch { return 0; } };
  function setBossFails(areaId, n) {
    try { const all = JSON.parse(localStorage.getItem(BOSS_KEY)) ?? {}; if (n) all[areaId] = n; else delete all[areaId]; localStorage.setItem(BOSS_KEY, JSON.stringify(all)); } catch {}
  }
  /** Un combat de boss est en cours tant que mem.bossFight est posé ; on regarde l'issue sur la sauvegarde. */
  function noteBossFight(area) { if (area && bossTeam(area).length) mem.bossFight = { areaId: area.id, gyms: (readSave()?.areaProgress?.[area.id]?.gymsDefeated ?? []).length }; }
  function settleBossFight(lost) {
    const f = mem.bossFight;
    if (!f) return;
    const prog = readSave()?.areaProgress?.[f.areaId];
    const won = !lost && ((prog?.gymsDefeated?.length ?? 0) > f.gyms || prog?.bossDefeated);
    if (lost) { const n = bossFails(f.areaId) + 1; setBossFails(f.areaId, n); log(`💀 défaite contre le boss (${n}) → préparation : l'équipe sera rebâtie contre son équipe avant de retenter`); }
    else if (won) { setBossFails(f.areaId, 0); log('🏆 boss battu'); notify('Boss battu', Rt.areaLabel(Rt.D.areas[f.areaId])); }
    mem.bossFight = null;
  }
  /** Le boss de la zone attend (manches faites, pas encore battu) : la préparation s'active. */
  function bossPending(area, save = readSave()) {
    if (!area || !bossTeam(area).length) return false;
    const p = save?.areaProgress?.[area.id];
    return !!p && !p.bossDefeated && (p.roundsDone ?? 0) >= (area.roundsToClear ?? 0) && (p.gymsDefeated?.length ?? 0) < gymTrainers(area).length + (area.legendaryBoss?.length ? 1 : 0);
  }
  function nextAreaFor(save = readSave()) {
    const prog = save?.areaProgress ?? {};
    const region = currentArea(save)?.regionId ?? save?.region;
    return Rt.D.areaList.find((a) => a.regionId === region && !a.hidden && !prog[a.id]?.cleared && !prog[a.id]?.bossDefeated && a.id !== save.currentAreaId) ?? null;
  }
  const readyForArea = (area, save = readSave()) => !area || avg(topLevels([...teamMons(save), ...boxMons(save)])) >= (area.minLevel ?? 0) - CONFIG.nextAreaLevelSlack;

  /* ── Pokédex : captures ET évolutions ── */
  const regionId = (save = readSave()) => currentArea(save)?.regionId ?? save?.region ?? 'kanto';
  const inRegionDex = (dex, region) => { const r = Rt.D.regions[region]?.dexRange; return !r || (dex >= r[0] && dex <= r[1]); };
  /** Évolutions valables dans la région (le jeu filtre `region` / `notInRegion`). */
  const evosOf = (dex, region) => (Rt.D.species[dex]?.evolutions ?? []).filter((e) => Rt.D.species[e.toDex] && (!e.region || e.region === region) && e.notInRegion !== region);

  /**
   * Toutes les espèces atteignables depuis `dex` par évolution, avec le niveau à atteindre
   * (max des paliers rencontrés) ou l'objet nécessaire. Ex. Chenipan → Chrysacier (N.7) → Papilusion (N.10).
   */
  function evoDescendants(dex, region) {
    const out = [];
    const walk = (d, lvl, item, depth) => {
      if (depth > 4) return;
      for (const e of evosOf(d, region)) {
        const need = Math.max(lvl, e.level ?? 0);
        const it = item ?? e.item ?? null;
        out.push({ toDex: e.toDex, level: e.item ? null : need, item: it });
        walk(e.toDex, need, it, depth + 1);
      }
    };
    walk(dex, 0, null, 0);
    return out;
  }

  /**
   * Pokémon possédés qui peuvent donner une espèce absente du Pokédex.
   * @returns {{mon, toDex, level:number|null, item:string|null, toGo:number}[]} trié par niveaux restants
   */
  /**
   * Évolutions par objet DIRECTEMENT possibles (Pierre Lune sur Mélofée…) vers une espèce absente du Pokédex.
   * @returns {{mon, toDex:number, item:string, owned:number}[]}
   */
  function itemEvolutions(save = readSave()) {
    const caught = new Set(save?.pokedex ?? []);
    const region = regionId(save);
    const have = save?.inventory ?? {};
    const seen = new Set();
    const out = [];
    for (const m of [...teamMons(save), ...boxMons(save)]) {
      for (const e of evosOf(m.dex, region)) {
        if (!e.item || caught.has(e.toDex) || seen.has(e.toDex) || !inRegionDex(e.toDex, region)) continue;
        seen.add(e.toDex);
        out.push({ mon: m, toDex: e.toDex, item: e.item, owned: have[e.item] ?? 0 });
      }
    }
    return out;
  }

  function evolutionTargets(save = readSave()) {
    const caught = new Set(save?.pokedex ?? []);
    const region = regionId(save);
    const out = [];
    for (const m of [...teamMons(save), ...boxMons(save)]) {
      if (!m.stats) continue;
      for (const d of evoDescendants(m.dex, region)) {
        if (caught.has(d.toDex) || !inRegionDex(d.toDex, region)) continue;
        out.push({ mon: m, toDex: d.toDex, level: d.level, item: d.item, toGo: d.item ? Infinity : Math.max(0, d.level - m.level) });
      }
    }
    // une seule ligne par espèce visée : le Pokémon le plus proche du palier
    const best = new Map();
    for (const t of out) if (!best.has(t.toDex) || t.toGo < best.get(t.toDex).toGo) best.set(t.toDex, t);
    return [...best.values()].sort((a, b) => a.toGo - b.toGo);
  }

  /**
   * Ce qu'une zone peut encore apporter au Pokédex :
   *  - capture d'une espèce sauvage absente ;
   *  - espèce absente atteignable en faisant évoluer une espèce sauvage de la zone qu'on ne possède pas
   *    (il faut d'abord la capturer ici, puis l'entraîner).
   */
  /**
   * Ce qu'une zone peut encore apporter au Pokédex.
   *  - focus 'catch' : espèces sauvages de la zone jamais capturées (rien d'autre) ;
   *  - focus 'evo'   : espèces de la zone à (re)capturer parce que leur évolution par niveau manque au Pokédex
   *                    et qu'on ne possède aucun Pokémon de la lignée pour l'entraîner.
   */
  function missingSpecies(area, save = readSave(), focus = CONFIG.dexFocus) {
    if (!area) return [];
    const caught = obtainedDex(save);
    const region = area.regionId ?? regionId(save);
    const wild = wildDexes(area);
    if (focus !== 'evo') return wild.filter((d) => !caught.has(d));
    const ownedReach = new Set();
    for (const m of [...teamMons(save), ...boxMons(save)]) { ownedReach.add(m.dex); for (const d of evoDescendants(m.dex, region)) if (d.level != null) ownedReach.add(d.toDex); }
    const need = new Set();
    for (const w of wild) for (const d of evoDescendants(w, region)) {
      if (d.level != null && !caught.has(d.toDex) && !ownedReach.has(d.toDex) && inRegionDex(d.toDex, region)) need.add(w);
    }
    return [...need];
  }

  /** Zone déjà ouverte : visitée (présente dans la sauvegarde) ou prochaine zone du parcours. */
  const isUnlocked = (area, save = readSave()) => !!save?.areaProgress?.[area.id] || area.id === nextAreaFor(save)?.id;

  /**
   * Mode Pokédex : une zone "piétine" si N rencontres passent sans nouvelle espèce au Pokédex
   * (espèce très rare, légendaire pas encore accessible…). On la met de côté un moment pour avancer ailleurs.
   */
  const DEX_STALL_KEY = 'pokebot.dexStall';
  const dexStallMap = () => { try { return JSON.parse(localStorage.getItem(DEX_STALL_KEY)) ?? {}; } catch { return {}; } };
  const dexStalled = (area) => !!area && Date.now() - (dexStallMap()[area.id] ?? 0) < CONFIG.pokedexStallMinutes * 60000;
  function noteDexProgress(save = readSave()) {
    if (CONFIG.mode !== 'pokedex' || !save) return;
    const n = save.pokedex?.length ?? 0;
    const w = mem.dexWatch;
    if (!w || w.areaId !== save.currentAreaId || n > w.dex) { mem.dexWatch = { areaId: save.currentAreaId, dex: n, enc: 0 }; return; }
    if (++w.enc < CONFIG.pokedexStallEncounters) return;
    const area = currentArea(save);
    const left = missingSpecies(area, save);
    try { localStorage.setItem(DEX_STALL_KEY, JSON.stringify({ ...dexStallMap(), [save.currentAreaId]: Date.now() })); } catch {}
    log(`📗 ${Rt.areaLabel(area)} : ${w.enc} rencontres sans nouvelle espèce (reste ${left.map((d) => Rt.nameOf(d)).join(', ') || '—'}) → mise de côté ${CONFIG.pokedexStallMinutes} min, on avance`);
    mem.dexWatch = null;
  }

  /**
   * Zone où le mode courant veut jouer.
   *  - progression : la suivante une fois la zone courante terminée
   *  - pokedex     : la courante tant qu'il y manque des espèces, sinon la première zone ouverte où il en manque
   *  - farm        : la zone de farm choisie
   */
  function desiredArea(save = readSave()) {
    const cur = currentArea(save);
    const prog = save?.areaProgress?.[save?.currentAreaId];
    const progression = () => {
      if (!prog?.cleared && !prog?.bossDefeated) return cur;
      const next = nextAreaFor(save);
      return next && readyForArea(next, save) ? next : cur;
    };
    // Espèce visée (tous modes) : la zone ouverte où elle apparaît le plus souvent
    const target = targetArea(save);
    if (target) return target;
    if (CONFIG.mode === 'farm') return (CONFIG.farmGoal === 'gold' && bestGoldArea(save)) || (CONFIG.farmGoal === 'xpAuto' && bestXpArea(save)) || (Rt.D.areas[CONFIG.farmAreaId] ?? cur);
    if (CONFIG.mode === 'pokedex') {
      // captures : zones avec des espèces sauvages jamais capturées ; évolutions : zones où recapturer une lignée
      if (missingSpecies(cur, save).length && !dexStalled(cur)) return cur;
      const region = cur?.regionId ?? save?.region;
      const cand = Rt.D.areaList.find((a) => a.regionId === region && a.id !== cur?.id && isUnlocked(a, save) && !mem.travelFail.has(a.id) && !dexStalled(a) && missingSpecies(a, save).length && readyForArea(a, save));
      if (cand) return cand;
      // Plus d'espèce sauvage : une zone où l'on trouve un fossile d'espèce manquante (objet trouvé en explorant)
      if (CONFIG.dexFocus === 'catch') {
        const fos = new Set(fossilTargets(save).filter((f) => !f.inShop || !CONFIG.buy.fossil).flatMap((f) => f.areas));
        if (fos.has(cur?.id) && !dexStalled(cur)) return cur;
        const fa = Rt.D.areaList.find((a) => fos.has(a.id) && a.id !== cur?.id && isUnlocked(a, save) && !mem.travelFail.has(a.id) && !dexStalled(a) && readyForArea(a, save));
        if (fa) return fa;
      }
      // Plus rien à capturer : on avance (en mode évolutions, les Pokémon en formation prennent l'XP de la zone suivante)
      return progression();
    }
    return progression();
  }

  /** Espèce visée par l'option catchTarget (null si vide, inconnue ou déjà obtenue — l'option est alors effacée). */
  function catchTargetDex(save = readSave()) {
    const name = String(CONFIG.catchTarget ?? '').trim();
    if (!name) return null;
    const dex = Rt.dexOf(name) ?? Object.values(Rt.D.species).find((sp) => norm(sp.name) === norm(name))?.dex ?? (Number.isFinite(+name) && Rt.D.species[+name] ? +name : null);
    if (!dex) { if (mem.targetLog !== name) { mem.targetLog = name; log(`⚠️ espèce visée inconnue : « ${name} »`); } return null; }
    if (obtainedDex(save).has(dex)) {
      log(`🎯 objectif atteint : ${Rt.nameOf(dex)} est au Pokédex`); notify('Objectif atteint', `${Rt.nameOf(dex)} est capturé !`);
      setOption('catchTarget', '');
      return null;
    }
    return dex;
  }
  /** Zone ouverte (région courante) où l'espèce visée a la plus grande part des rencontres sauvages. */
  function targetArea(save = readSave()) {
    const dex = catchTargetDex(save);
    if (!dex) return null;
    const region = regionId(save);
    let best = null;
    for (const a of Rt.D.areaList) {
      if (a.regionId !== region || !isUnlocked(a, save) || mem.travelFail.has(a.id) || !readyForArea(a, save)) continue;
      const pool = (a.wildPool ?? []).filter((w) => (w.weight ?? 1) > 0);
      const total = pool.reduce((n, w) => n + (w.weight ?? 1), 0);
      const share = total ? pool.filter((w) => w.dex === dex).reduce((n, w) => n + (w.weight ?? 1), 0) / total : 0;
      if (share > 0 && (!best || share > best.share)) best = { a, share };
    }
    if (!best) { if (mem.targetLog !== 'none:' + dex) { mem.targetLog = 'none:' + dex; log(`🎯 ${Rt.nameOf(dex)} : aucune zone ouverte de la région ne l'a en sauvage`); } return null; }
    if (mem.targetLog !== best.a.id) { mem.targetLog = best.a.id; log(`🎯 objectif ${Rt.nameOf(dex)} : ${Rt.areaLabel(best.a)} (${Math.round(best.share * 100)} % des rencontres sauvages)`); }
    return best.a;
  }

  /**
   * ₽ espérés par rencontre dans une zone : seuls les dresseurs paient
   * (≈ 2 Pokémon × niveau moyen × goldMultiplier, ×0,5 si la zone est terminée).
   */
  function goldPerEncounter(area, save = readSave()) {
    const w = area?.encounterWeights ?? {};
    const total = Object.values(w).reduce((a, b) => a + (b || 0), 0);
    if (!total || !w.trainer) return 0;
    const lvl = ((area.minLevel ?? 1) + (area.maxLevel ?? area.minLevel ?? 1)) / 2;
    const p = save?.areaProgress?.[area.id];
    const back = p?.cleared || p?.bossDefeated ? area.backtrackMultiplier ?? 0.5 : 1;
    return (w.trainer / total) * 2 * lvl * (Rt.D.config.goldMultiplier ?? 0.5) * back;
  }
  /**
   * XP espérée par rencontre (port de AJ) : niveau moyen adverse × xpMultiplier (jeu et zone), ×0,5 si la zone est terminée.
   * Seuls les combats (sauvages, dresseurs) rapportent : objets, Centre et Casino comptent pour zéro.
   */
  function xpPerEncounter(area, save = readSave()) {
    const w = area?.encounterWeights ?? { wild: 1 };
    const total = Object.values(w).reduce((a, b) => a + (b || 0), 0);
    if (!total) return 0;
    const fights = ((w.wild ?? 0) + (w.trainer ?? 0)) / total;
    const lvl = ((area.minLevel ?? 1) + (area.maxLevel ?? area.minLevel ?? 1)) / 2;
    const p = save?.areaProgress?.[area.id];
    const back = p?.cleared || p?.bossDefeated ? area.backtrackMultiplier ?? 0.5 : 1;
    return fights * lvl * (Rt.D.config.xpMultiplier ?? 1) * (area.xpMultiplier ?? 1) * back;
  }
  /** Zone ouverte qui rapporte le plus d'XP par rencontre et que le meilleur Pokémon de l'équipe tient sans risque. */
  function bestXpArea(save = readSave()) {
    if (mem.xpArea && Date.now() - mem.xpArea.at < 60000) return Rt.D.areas[mem.xpArea.id] ?? null;
    const carrier = teamMons(save).filter((m) => m.stats).sort((a, b) => b.level - a.level)[0];
    const region = currentArea(save)?.regionId ?? save?.region;
    const cands = carrier ? Rt.D.areaList.filter((a) => a.regionId === region && !a.hidden && save?.areaProgress?.[a.id] && !mem.travelFail.has(a.id)) : [];
    let best = null;
    for (const a of cands) {
      const xp = xpPerEncounter(a, save);
      if (!(xp > (best?.xp ?? 0))) continue;
      if (scoreVsThreats(carrier, compactThreats(areaThreats(a)), a) < CONFIG.carrierSafeScore) continue;
      best = { a, xp };
    }
    mem.xpArea = { id: best?.a.id ?? null, at: Date.now() };
    if (best && mem.xpAreaLog !== best.a.id) { mem.xpAreaLog = best.a.id; log(`📈 farm XP : ${Rt.areaLabel(best.a)} (≈ ${best.xp.toFixed(1)} XP par rencontre, ${carrier.name} la tient sans risque)`); }
    return best?.a ?? null;
  }
  /** Zone ouverte la plus rentable que l'équipe tient sans risque (niveau max ≤ niveau moyen du top 3). */
  function bestGoldArea(save = readSave()) {
    if (mem.goldArea && Date.now() - mem.goldArea.at < 60000) return Rt.D.areas[mem.goldArea.id] ?? null;
    const lv = avg(topLevels(teamMons(save)));
    const region = currentArea(save)?.regionId ?? save?.region;
    const cands = Rt.D.areaList.filter((a) => a.regionId === region && !a.hidden && save?.areaProgress?.[a.id] && !mem.travelFail.has(a.id) && (a.maxLevel ?? 0) <= lv + 1);
    const best = cands.map((a) => ({ a, g: goldPerEncounter(a, save) })).sort((x, y) => y.g - x.g)[0];
    mem.goldArea = { id: best?.a.id ?? null, at: Date.now() };
    if (best && mem.goldAreaLog !== best.a.id) { mem.goldAreaLog = best.a.id; log(`💰 farm à ₽ : ${Rt.areaLabel(best.a)} (≈ ₽${best.g.toFixed(1)} par rencontre)`); }
    return best?.a ?? null;
  }

  /* ── XP : Multi Exp, porteur et élèves ── */
  const maxLevel = () => Rt.D.config.maxLevel ?? 100;
  /** Multi Exp actif : config du jeu (multiExpShare > 0, mode "fighter") et réglage du joueur. */
  const multiExpOn = (save = readSave()) => (Rt.D.config.multiExpShare ?? 0) > 0 && Rt.D.config.xpShareMode !== 'team' && save?.settings?.multiExp !== false;
  /**
   * Part d'XP d'un membre qui ne combat pas (port de CJ) : 30 % + 5 % par niveau d'écart avec le combattant, plafonnée.
   * xpShareMode "team" : tout le monde reçoit 100 %.
   */
  function xpShare(fighterLevel, memberLevel, save = readSave()) {
    const c = Rt.D.config;
    if (c.xpShareMode === 'team') return 1;
    if (!multiExpOn(save)) return 0;
    const cap = clamp(c.multiExpMaxShare ?? 1, 0, 1);
    return clamp((c.multiExpShare ?? 0) + Math.max(0, fighterLevel - memberLevel) * Math.max(0, c.multiExpGapBonus ?? 0), 0, cap);
  }
  /**
   * XP utile si `lead` combat : chaque membre sous le niveau max reçoit sa part (100 % pour le combattant),
   * pondérée par sa priorité (élève désigné ×2). L'XP d'un Pokémon au niveau max est perdue.
   */
  function usefulXp(lead, team, save = readSave()) {
    const max = maxLevel();
    const prio = (m) => (mem.xpTrainees?.includes(m.id) || m.id === mem.trainee ? 2 : 1);
    return team.reduce((n, m) => n + (m.level >= max ? 0 : (m.id === lead.id ? 1 : xpShare(lead.level, m.level, save)) * prio(m)), 0);
  }
  /** Potentiel d'un Pokémon au niveau max (PV × dégâts moyens bruts) : départage les élèves sans autre priorité. */
  function potentialAtMax(m) {
    const st = Rt.E.speciesAt(m.dex, maxLevel());
    if (!st) return 0;
    const avgDie = (t) => { const fs = Rt.E.facesOf(t); return fs.reduce((a, f) => a + Rt.E.faceVal(f), 0) / fs.length; };
    return st.maxHp * st.dice.reduce((a, t) => a + avgDie(t), 0);
  }
  /**
   * Élèves à faire monter, par priorité :
   *  1. une évolution par niveau qui manque au Pokédex ;  2. Versus : les plus hauts sous le N.50 tant qu'il n'y en a pas 3 ;
   *  3. le contre du raid perdu (raidTrain) ;  4. le meilleur potentiel au niveau max.
   * Jamais un fossile, un Pokémon au niveau max ni un porteur.
   * @returns {{m:object, why:string}[]}
   */
  function pickTrainees(save, n, exclude = new Set()) {
    if (n <= 0) return [];
    const max = maxLevel();
    const pool = [...teamMons(save), ...boxMons(save)].filter((m) => m.stats && !m.fossil && m.level < max && !exclude.has(m.id));
    const out = [], taken = new Set();
    const take = (m, why) => { if (m && !taken.has(m.id) && out.length < n && pool.some((x) => x.id === m.id)) { taken.add(m.id); out.push({ m, why }); } };
    for (const t of evolutionTargets(save)) if (t.level != null && t.toGo > 0) take(pool.find((x) => x.id === t.mon.id), `évolution ${Rt.nameOf(t.toDex)} au N.${t.level}`);
    const vsLevel = 50;
    const n50 = (save?.box ?? []).filter((m) => m.level >= vsLevel).length;
    if (n50 < 3) for (const m of [...pool].filter((x) => x.level < vsLevel).sort((a, b) => b.level - a.level).slice(0, 3 - n50)) take(m, 'Versus (N.50)');
    const rt = actState().raidTrain;
    if (rt && rt.until > Date.now()) { const t = raidTrainee(save, rt.dex, rt.level); if (t) take(t.m, `raid contre ${Rt.nameOf(rt.dex)}`); }
    for (const m of [...pool].sort((a, b) => potentialAtMax(b) - potentialAtMax(a))) take(m, 'potentiel au N.' + max);
    return out;
  }

  /**
   * Équipe « porteur + élèves » : le meilleur duel contre la zone porte l'équipe (2 porteurs s'il reste sous
   * carrierSafeScore), un élève déjà désigné (boss, évolution, raid) garde sa place, le reste va à pickTrainees.
   * @param {object[]} cands  candidats évalués au Centre (équipe + meilleurs niveaux de la Boîte)
   */
  function xpTeamPlan(save, cands, threats, area, size, keep = null) {
    const raw = cands.filter((m) => m.stats).map((m) => ({ m, s: scoreVsThreats(m, threats, area) })).sort((a, b) => b.s - a.s);
    const nCarriers = Math.min(size, raw[0] && raw[0].s >= CONFIG.carrierSafeScore ? 1 : 2);
    const carriers = raw.slice(0, nCarriers).map((x) => x.m);
    const kept = keep && !carriers.some((c) => c.id === keep.id) && carriers.length < size ? [keep] : [];
    const trainees = pickTrainees(save, size - carriers.length - kept.length, new Set([...carriers, ...kept].map((m) => m.id)));
    return { carriers, kept, trainees };
  }

  /* ── 6.5 Centre Pokémon : composition d'équipe + meneur ── */
  async function playCenter() {
    const save = readSave();
    const area = currentArea(save);
    const prepBoss = bossPending(area, save) && !teamReadyForBoss(area, save, { quiet: true });
    const visit = `${save?.currentAreaId}|${save?.areaProgress?.[save.currentAreaId]?.round}|${save?.box.length}|${prepBoss}|${bossFails(area?.id)}`;
    if (!CONFIG.manageTeam || mem.centerDone === visit) return false;
    if (CONFIG.lockTeam) { mem.centerDone = visit; log('🔒 Centre : équipe verrouillée, aucun changement'); return false; }
    // Boss qui bloque : on construit l'équipe CONTRE SON ÉQUIPE (pondération forte), sans oublier la zone (on y grind)
    const bossThreats = bossTeam(area).map((b) => ({ ...b, weight: 1 }));
    const threats = compactThreats(prepBoss ? [...areaThreats(area), ...bossThreats.map((b) => ({ ...b, weight: 8 }))] : areaThreats(area));
    const team = teamMons(save);
    // Boîte : seuls les meilleurs niveaux peuvent prétendre à une place → on borne le travail
    const box = boxMons(save).filter((m) => m.stats && !m.fossil).sort((a, b) => b.level - a.level).slice(0, CONFIG.centerMaxBox);
    const all = [];
    const t0 = performance.now();
    for (const m of [...team, ...box]) {
      if (!m.stats) continue;
      all.push({ m, s: scoreVsThreats(m, threats, area) * (1 + m.level / 50) });
      await sleep(0); // rend la main au navigateur entre deux Pokémon : la page ne gèle jamais
      if (performance.now() - t0 > CONFIG.centerTimeBudgetMs) {
        log(`⏱️ Centre : évaluation trop longue (${all.length} Pokémon en ${Math.round(performance.now() - t0)} ms) → équipe conservée`);
        mem.centerDone = visit;
        return false;
      }
    }
    if (CONFIG.debug) log(`🏥 Centre : ${all.length} Pokémon × ${threats.length} menaces évalués en ${Math.round(performance.now() - t0)} ms`);
    all.sort((a, b) => b.s - a.s);
    const size = Rt.D.config.maxTeamSize ?? 3;
    const want = all.slice(0, size).map((x) => x.m);
    const teamIds = new Set(team.map((m) => m.id));

    // Préparation boss : le meilleur "contre" au niveau du boss entre en formation (il prendra de l'XP)
    mem.trainee = null;
    if (prepBoss && bossThreats.length) {
      const bossLvl = Math.round(avg(bossThreats.map((b) => b.level)));
      const potential = (m) => { const st = Rt.E.speciesAt(m.dex, Math.max(m.level, bossLvl)); return st ? scoreVsThreats({ ...m, stats: st, maxHp: st.maxHp }, compactThreats(bossThreats), area) : 0; };
      let best = null;
      for (const x of all) { const p = potential(x.m); if (!best || p > best.p) best = { m: x.m, p }; await sleep(0); }
      const curBest = Math.max(...want.map(potential));
      if (best && !want.some((m) => m.id === best.m.id) && best.p > curBest * CONFIG.bossTraineeGain) {
        log(`🎓 formation : ${best.m.name} N.${best.m.level} (potentiel ${best.p.toFixed(2)} contre le boss, vs ${curBest.toFixed(2)})`);
        want[want.length - 1] = best.m;
      }
      if (best) mem.trainee = want.some((m) => m.id === best.m.id) ? best.m.id : null;
    }

    // Mode Pokédex : le Pokémon le plus proche d'une évolution manquante entre en formation
    if (!prepBoss && CONFIG.mode === 'pokedex' && CONFIG.dexFocus === 'evo') {
      const t = evolutionTargets(save).find((x) => x.level != null && x.toGo > 0);
      if (t) {
        if (!want.some((m) => m.id === t.mon.id)) want[want.length - 1] = t.mon;
        mem.trainee = t.mon.id;
        log(`🎓 formation Pokédex : ${t.mon.name} N.${t.mon.level} → ${Rt.nameOf(t.toDex)} au N.${t.level} (encore ${t.toGo} niveau${t.toGo > 1 ? 'x' : ''})`);
      }
      const stones = itemEvolutions(save).filter((x) => x.owned === 0);
      const sig = stones.map((x) => x.toDex).join(',');
      if (stones.length && mem.stoneLog !== sig) { mem.stoneLog = sig; log(`💎 évolutions en attente d'un objet (achetées en boutique dès que possible) : ${stones.slice(0, 6).map((x) => `${x.mon.name} → ${Rt.nameOf(x.toDex)} (${Rt.t('item.' + x.item, x.item)})`).join(', ')}`); }
    }

    // Raids : après une défaite nette, le meilleur « contre » du boss pas encore au niveau plafond prend l'XP
    const rt = actState().raidTrain;
    if (!prepBoss && !mem.trainee && CONFIG.raidTrain && rt && rt.until > Date.now()) {
      const t = raidTrainee(save, rt.dex, rt.level);
      if (!t) setActState({ raidTrain: null });
      else {
        if (!want.some((m) => m.id === t.m.id)) want[want.length - 1] = t.m;
        mem.trainee = t.m.id;
        if (mem.raidTrainLog !== t.m.id) { mem.raidTrainLog = t.m.id; log(`🎓 formation raid : ${t.m.name} N.${t.m.level} → N.${raidCfg()?.teamCap ?? 50} contre ${Rt.nameOf(rt.dex)}`); }
      }
    }

    // XP : le plus fort porte l'équipe, les autres places vont à des élèves (Multi Exp : 100 % de l'XP sans combattre).
    // Pas pendant la préparation d'un boss : l'équipe complète compte alors.
    mem.xpTrainees = [];
    if (CONFIG.xpTrainees && !prepBoss && size > 1) {
      const { carriers, kept, trainees } = xpTeamPlan(save, all.map((x) => x.m), threats, area, size, mem.trainee ? want.find((m) => m.id === mem.trainee) : null);
      if (carriers.length && (multiExpOn(save) || Rt.D.config.xpShareMode === 'team')) {
        want.splice(0, want.length, ...carriers, ...kept, ...trainees.map((t) => t.m));
        mem.xpTrainees = [...kept.map((m) => m.id), ...trainees.map((t) => t.m.id)];
        const sig = want.map((m) => m.id).join(',');
        if (mem.xpLog !== sig) {
          mem.xpLog = sig;
          log(`🎓 XP : ${carriers.map((m) => `${m.name} N.${m.level}`).join(' + ')} porte${carriers.length > 1 ? 'nt' : ''} l'équipe${trainees.length ? ' · élèves : ' + trainees.map((t) => `${t.m.name} N.${t.m.level} (${t.why})`).join(', ') : ''}`);
        }
      } else if (!multiExpOn(save) && !mem.multiExpWarned) {
        mem.multiExpWarned = true;
        log('⚠️ Multi Exp désactivé dans les réglages du jeu : seuls les combattants gagnent de l’XP (le bot fait mener les élèves quand c’est sans risque)');
      }
    }

    // 1) Faire entrer un Pokémon de la Boîte s'il est meilleur
    const incoming = want.find((m) => !teamIds.has(m.id));
    if (incoming) {
      // Sort le plus faible de l'équipe qui n'est PAS dans l'équipe voulue (jamais le Pokémon en formation)
      const outgoing = [...team].filter((m) => !want.some((w) => w.id === m.id)).sort((a, b) => (all.find((x) => x.m.id === a.id)?.s ?? 0) - (all.find((x) => x.m.id === b.id)?.s ?? 0))[0];
      const card = $$('main button').find((x) => visible(x) && norm(x.innerText).startsWith(norm(incoming.name)) && x.innerText.includes(String(incoming.level)) && !teamCardIds().has(x));
      if (card) {
        card.click(); await sleep(500);
        const d = dialog() ?? document;
        const add = btn(['ui.center.addToTeam'], { scope: d });
        if (add) { add.click(); await sleep(500); }
        const d2 = dialog() ?? document;
        const swapTarget = $$('button', d2).find((x) => visible(x) && enabled(x) && norm(x.innerText).startsWith(norm(outgoing?.name ?? '§')));
        if (swapTarget && team.length >= size) { swapTarget.click(); await sleep(500); }
        log(`🔁 Centre : ${incoming.name} N.${incoming.level} entre${team.length >= size ? ', ' + (outgoing?.name ?? '?') + ' va en Boîte' : ''}`);
        if (dialog()) closeDialog();
        return true;
      }
    }

    // 2) Meneur : le meilleur contre les menaces de la zone
    mem.centerDone = visit;
    const lead = want[0];
    const curLead = team[0];
    if (lead && curLead && lead.id !== curLead.id && teamIds.has(lead.id)) {
      const card = $$('main button').find((x) => visible(x) && norm(x.innerText).startsWith(norm(lead.name)));
      if (card) {
        card.click(); await sleep(500);
        const mk = btn('ui.team.makeLead', { scope: dialog() ?? document });
        if (mk) { log(`👑 Centre : ${lead.name} en tête`); mk.click(); await sleep(400); }
        if (dialog()) closeDialog();
        return true;
      }
    }
    return false;
  }
  function teamCardIds() { return new Set(); } // les cartes équipe/boîte se distinguent par la section ; on filtre par niveau

  /* ── 6.6 Capture ── */
  /**
   * Choix de la Ball parmi les options affichées ({pct, price, bonus, master}) :
   *  - chromatique / légendaire : la meilleure chance, au prix le plus bas pour cette chance ;
   *  - nouvelle espèce : la moins chère qui atteint catchNewPct (100 % par défaut, sinon la meilleure) ;
   *  - espèce connue : selon catchKnown (Sans Ball / la moins chère / catchMinPct), jamais la meilleure Ball.
   */
  function chooseBall(opts, { legendary = false, rare = false, why = '' } = {}) {
    const byPrice = (a, b) => a.price - b.price || b.pct - a.pct;
    const usable = opts.filter((o) => !o.master || legendary); // Master Ball : légendaires uniquement
    if (!usable.length) return opts[0];
    const bestPct = Math.max(...usable.map((o) => o.pct));
    const cheapestAt = (pct) => [...usable].sort(byPrice).find((o) => o.pct >= pct);
    if (legendary || (rare && why !== 'nouvelle espèce')) return cheapestAt(bestPct);
    if (rare) return cheapestAt(Math.min(bestPct, CONFIG.catchNewPct));
    const topBonus = Math.max(...usable.map((o) => o.bonus));
    const common = usable.filter((o) => o.bonus < topBonus || usable.every((x) => x.bonus === topBonus));
    const free = common.find((o) => o.price === 0);
    if (CONFIG.catchKnown === 'free' && free) return free;
    if (CONFIG.catchKnown === 'cheap') return [...common].filter((o) => o.price > 0).sort(byPrice)[0] ?? free ?? common[0];
    return [...common].sort(byPrice).find((o) => o.pct >= CONFIG.catchMinPct) ?? [...common].sort((a, b) => b.pct - a.pct)[0] ?? usable[0];
  }

  async function playCatch() {
    const ballRe = Rt.re('ui.catch.ballLabel');
    const opts = $$('button, [role=radio]').filter((x) => visible(x) && enabled(x)).map((el) => {
      const t = norm(el.getAttribute('aria-label') || el.innerText);
      const pct = +(t.match(/(\d+)\s*%/)?.[1] ?? NaN);
      return ballRe.test(t) && Number.isFinite(pct) ? { el, t, pct } : null;
    }).filter(Boolean);
    const legendary = bodyHas('ui.catch.theLegendary');
    const rare = legendary || !!mem.rare;
    let picked = null;
    if (opts.length) {
      // Objet derrière chaque option ("Sans Ball" → aucun, prix 0)
      const itemOf = (o) => { const k = [...Rt.itemNameToKey.entries()].find(([n]) => o.t.startsWith(n))?.[1]; return k ? Rt.D.items[k] : null; };
      for (const o of opts) { const it = itemOf(o); o.price = it?.price ?? 0; o.bonus = it?.effect?.bonus ?? 0; o.master = (it?.effect?.bonus ?? 0) >= 10; }
      const pick = chooseBall(opts, { legendary, rare, why: mem.rare?.why });
      if (pick && pick.el.getAttribute('aria-pressed') !== 'true' && pick.el.getAttribute('aria-checked') !== 'true') { pick.el.click(); await sleep(250); }
      log(`🎯 capture${rare ? ' (' + (legendary ? 'légendaire' : mem.rare.why) + ')' : ''} : ${pick.t}`);
      picked = pick.t.split(':')[0].trim();
    }
    const bait = btn(rare ? 'ui.catch.baitThrow' : 'ui.catch.baitKeep');
    if (bait) { bait.click(); return true; }
    const roll = btn(['ui.catch.roll', 'ui.catch.catch', 'ui.catch.throwAgain']);
    if (roll) {
      const dex = mem.rare?.dex;
      if (roll !== btn('ui.catch.throwAgain')) mem.throwPending = { at: Date.now(), ball: picked ?? Rt.t('ui.catch.noBall', 'Sans Ball'), isNew: mem.rare?.why === 'nouvelle espèce', shiny: mem.rare?.why === 'chromatique', legendary, name: dex ? Rt.nameOf(dex) : '' };
      roll.click(); return true;
    }
    return opts.length > 0;
  }

  /* ── 6.7 Écrans de victoire / évolution / équipe pleine ── */
  async function playVictory() {
    if (bodyHas('ui.victory.teamFull')) {
      // Le nouveau va en Boîte : la composition est optimisée au Centre
      const no = btn(['ui.common.cancel', 'ui.common.continue', 'ui.victory.skip', 'ui.common.close']);
      if (no) { log('📦 nouveau Pokémon → Boîte (équipe optimisée au Centre)'); no.click(); return true; }
    }
    const goNew = btn('ui.victory.goToNewArea');
    if (goNew) {
      const next = nextAreaFor();
      const wantsNext = CONFIG.mode === 'progression' || (CONFIG.mode === 'pokedex' && next && desiredArea()?.id === next.id);
      if (wantsNext && CONFIG.autoTravel && readyForArea(next)) { log(`🗺️ nouvelle zone : ${Rt.areaLabel(next)}`); goNew.click(); return true; }
      // Pokédex / Farm : on reste — la zone terminée passe en "jeu libre" et reste explorable
      const stay = btn(['ui.common.continue', 'ui.home.keepExploring', 'ui.area.explore', 'ui.victory.skip'], { scope: dialog() ?? document });
      if (stay) { log(`📍 zone terminée — on reste (mode ${MODES[CONFIG.mode].label})`); stay.click(); return true; }
      if (closeDialog()) return true;
    }
    const b = btn(['ui.victory.nextBattle', 'ui.evolution.next', 'ui.evolution.skip', 'ui.victory.skip']);
    if (b) { b.click(); return true; }
    return false;
  }

  /* ── 6.8 Zone (entre deux rencontres / accueil) ── */
  async function playArea() {
    if (encounterKind()) return false;
    // Pendant un combat : seule la modale de fin (VICTOIRE…) posée sur la section combat peut être validée.
    // Jamais de courses ni de navigation tant que la section combat existe.
    const fight = readBattle();
    if (fight) {
      const d = dialog();
      if (fight.attackBtn || fight.skipTurnBtn || (d && isBagDialog(d))) return false;
      // fin de combat : VICTOIRE (modale) ou résultat de capture (dans la section)
      const c = btn('ui.common.continue', { scope: d ?? fight.region });
      if (c) { c.click(); return true; }
      return false;
    }
    if (mem.bossFight?.seen && !bodyHas('ui.wipe.title')) settleBossFight(false); // combat de boss vu puis terminé sans K.O. d'équipe
    const save = readSave();
    const area = currentArea(save);
    const challenge = btn(['ui.area.challenge', 'ui.area.faceIt']);
    // Pas prêt → on continue d'explorer : XP pour l'équipe (rebâtie contre le boss au prochain Centre)
    if (challenge && teamReadyForBoss(area, save)) { log(`🏆 défi : ${norm(challenge.innerText)}`); mem.megaUsed = false; mem.fightKind = 'gym'; noteBossFight(area); challenge.click(); return true; }
    if (CONFIG.useEvolutionItems && startItemEvolution(save)) return true;
    if (CONFIG.schedule && applySchedule()) return true;
    if (await errandTick(save)) return true;
    if (CONFIG.activity && (await activityTick())) return true;
    if (CONFIG.economy && (await chores(mem.forceChores))) { mem.forceChores = false; return true; }
    if (CONFIG.autoTravel && (await travel())) return true;
    const cont = btn(['ui.home.backToEncounter', 'ui.common.continue', 'ui.area.explore', 'ui.home.keepExploring', 'ui.home.continueHere']);
    if (cont) { cont.click(); return true; }
    return false;
  }

  /**
   * Changement de zone quand la zone courante est finie : le bouton "Zones" n'existe que sur l'accueil,
   * donc on y retourne d'abord, puis Zones → ligne de la zone (nom localisé, peut être préfixé "ARÈNE") → GO.
   */
  /**
   * « Termine d'abord cette rencontre » : une rencontre (Casino, Centre, bonbon ou sort…) attend dans la zone.
   * On revient dessus avec « Retour à la rencontre » / CONTINUER ; le changement de zone attend qu'elle soit finie.
   */
  async function resumeEncounter(force = false) {
    const back = btn('ui.home.backToEncounter');
    if (!back && !force) return false;
    mem.encounterPending = Date.now();
    log('🚧 changement de zone refusé par le jeu : une rencontre est en cours dans la zone → on la termine d\'abord');
    const b = back ?? btn(['ui.common.continue', 'ui.home.continueHere']);
    if (b) { b.click(); return true; }
    goHome();
    return true;
  }

  async function travel() {
    const save = readSave();
    const next = desiredArea(save);
    if (!next || next.id === save?.currentAreaId || mem.travelFail.has(next.id)) return false;
    // Le jeu refuse de changer de zone tant qu'une rencontre est ouverte : on y retourne d'abord
    if (mem.encounterPending && Date.now() - mem.encounterPending < 120000) return false;
    if (await resumeEncounter()) return true;
    const label = norm(Rt.areaLabel(next));
    const open = zonesButton();
    if (!open) {
      if (CONFIG.mode === 'progression') { const back = btn(['ui.victory.goToNewArea', 'ui.area.backToMap']); if (back) { back.click(); return true; } }
      if (location.pathname !== '/home') { log(`🏠 cap sur ${Rt.areaLabel(next)} (mode ${MODES[CONFIG.mode].label}) → accueil`); return goHome(); }
      if (mem.zonesMissLog !== next.id) { mem.zonesMissLog = next.id; log(`⚠️ bouton Zones introuvable sur l'accueil — boutons : ${$$('button[aria-label]').filter(visible).map((x) => x.getAttribute('aria-label').slice(0, 30)).join(' | ')}`); }
      return false;
    }
    open.click();
    const d = await waitFor(() => dialog() || bodyHas('ui.home.finishFirst') || btn('ui.home.backToEncounter'), 900);
    if (bodyHas('ui.home.finishFirst') || btn('ui.home.backToEncounter')) { closeDialog(); return resumeEncounter(true); }
    if (!d || d === true) { log('⚠️ la liste des zones ne s\'est pas ouverte'); return false; }
    const rows = $$('button', d).filter(visible);
    // "ARÈNE Forêt de Jade N.4–8 …" : le nom est suivi du niveau ; évite "… Termine Forêt de Jade" d'une autre ligne
    const rowRe = new RegExp(`(^|\\s)${esc(label)}\\s+N\\.`);
    const idx = rows.findIndex((x) => rowRe.test(norm(x.innerText)));
    const goBtn = idx >= 0 ? rows.slice(idx, idx + 3).find((x) => Rt.re('ui.home.go').test(norm(x.innerText))) : null;
    if (goBtn) { log(`🗺️ cap sur ${Rt.areaLabel(next)}`); goBtn.click(); await sleep(600); return true; }
    if (idx >= 0) { rows[idx].click(); await sleep(500); const g = btn('ui.home.go', { scope: dialog() ?? document }); if (g) { log(`🗺️ cap sur ${Rt.areaLabel(next)}`); g.click(); return true; } }
    log(`⚠️ zone introuvable ou pas encore ouverte sur la carte : ${label}`);
    mem.travelFail.add(next.id); // évite de boucler ; réarmé au rechargement ou au changement de mode
    closeDialog();
    return true;
  }

  /* ── 6.11 Activités : Versus et Raids ──
   * Modes "activité" : le bot y va dès que c'est ouvert et qu'il reste quelque chose à faire ;
   * le reste du temps il joue dans le mode de repli (CONFIG.activityFallback) et revérifie régulièrement.
   * Aucune contournement des verrous du jeu : Versus = 3 Pokémon au N.50 + compte connecté ; Raid du jour = zone de
   * déblocage terminée ; raids légendaires = leur zone terminée.
   */
  const ACT_KEY = 'pokebot.activity';
  const actState = () => { try { return JSON.parse(localStorage.getItem(ACT_KEY)) ?? {}; } catch { return {}; } };
  const setActState = (patch) => { try { localStorage.setItem(ACT_KEY, JSON.stringify({ ...actState(), ...patch })); } catch {} };
  const utcDay = () => new Date().toISOString().slice(0, 10);
  const msToUtcMidnight = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime(); };
  /** Navigation interne (React Router écoute popstate) — repli quand aucun lien n'est visible. */
  const navTo = (path) => { if (go(path)) return true; history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); return true; };
  const actLog = (key, msg) => { if (mem.actLog?.[key] !== msg) { (mem.actLog ??= {})[key] = msg; log(msg); } };

  /* ---- Versus ---- */
  const VERSUS_TEAM = 3;
  const versusEligible = (save = readSave()) => (save?.box ?? []).filter((m) => m.level >= 50).length >= VERSUS_TEAM;
  const versusLevels = () => Rt.E.allLevels(Rt.D.config.versusUpgradeLevel ?? 5);
  const clone50 = (dex) => { const st = Rt.E.speciesAt(dex, 50); return st ? { dex, stats: st, hp: st.maxHp, levels: versusLevels() } : null; };

  /**
   * Dégâts moyens par tour, version RAPIDE pour le Versus (milliers de duels à évaluer) :
   * somme des faces moyennes + bonus de dé, × efficacité du meilleur type d'attaque. Mis en cache par paire d'espèces.
   * (Le calcul exact énumère jusqu'à 1 296 lancers par duel : bien trop lent sur une grosse Boîte.)
   */
  const fastCache = new Map();
  function fastDmg(a, d) {
    const key = `${a.dex}>${d.dex}`;
    let v = fastCache.get(key);
    if (v !== undefined) return v;
    const types = [...new Set(a.stats.dice.filter((t) => t !== 'base' && Rt.D.dice[t]?.countsForMajority !== false))];
    const mult = types.length ? Math.max(...types.map((t) => Rt.E.eff(t, d.stats.types))) : 1;
    let sum = 0;
    for (const t of a.stats.dice) { const fs = Rt.E.facesOf(t); sum += fs.reduce((n, f) => n + Rt.E.faceVal(f), 0) / fs.length + Rt.E.dieBonus(t, a.levels); }
    v = Math.max(0.1, sum * mult);
    if (fastCache.size > 50000) fastCache.clear();
    fastCache.set(key, v);
    return v;
  }

  /**
   * Combat d'équipes simulé (espérance) : chaque Pokémon affronte le Pokémon adverse en tête, les PV restants
   * sont conservés. @returns {number} marge ∈ [-1, 1] (>0 : A gagne ; part de PV restante de A − celle de B)
   */
  function teamFight(A, B) {
    const hA = A.map((m) => m.stats.maxHp), hB = B.map((m) => m.stats.maxHp);
    let i = 0, j = 0, guard = 0;
    while (i < A.length && j < B.length && guard++ < 20) {
      const a = A[i], b = B[j];
      const dA = fastDmg(a, b), dB = fastDmg(b, a);
      const tA = Math.ceil(hB[j] / dA), tB = Math.ceil(hA[i] / dB);
      const aFirst = a.stats.speed >= b.stats.speed;
      if (aFirst ? tA <= tB : tA < tB) { hA[i] -= (aFirst ? tA - 1 : tA) * dB; hB[j] = 0; j++; }
      else { hB[j] -= (aFirst ? tB : tB - 1) * dA; hA[i] = 0; i++; }
    }
    const frac = (h, T) => h.reduce((n, x) => n + Math.max(0, x), 0) / T.reduce((n, m) => n + m.stats.maxHp, 0);
    return frac(hA, A) - frac(hB, B);
  }

  /**
   * Recherche d'équipe Versus (3 Pokémon N.50+ de la Boîte, clones au N.50) et de son ordre.
   * Rapide : présélection des 8 meilleurs en 1 contre 1 (estimation rapide), puis les 336 équipes ordonnées.
   * @param {(team, field) => number} scoreFn  note d'une équipe contre le terrain
   */
  function searchVersusTeam(save, foes, scoreFn, cacheKey) {
    const sig = `${cacheKey}|${(save?.box ?? []).filter((m) => m.level >= 50).map((m) => m.dex).sort().join(',')}|${foes.map((t) => t.join('.')).join(',')}`;
    if ((mem.vsCache ??= new Map()).has(sig)) return mem.vsCache.get(sig);
    const pool = [...new Set((save?.box ?? []).filter((m) => m.level >= 50).map((m) => m.dex))].map(clone50).filter(Boolean);
    let res = null;
    if (pool.length >= VERSUS_TEAM) {
      const field = foes.length ? foes.map((t) => t.map(clone50).filter(Boolean)).filter((t) => t.length) : [];
      const rivals = field.length ? field.flat() : pool;
      // 1 contre 1 : tours pour mourir / tours pour tuer, borné
      const solo = pool.map((m) => ({ m, s: avg(rivals.map((f) => Math.min(4, (m.stats.maxHp / fastDmg(f, m)) / (f.stats.maxHp / fastDmg(m, f))))) }))
        .sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.m);
      const teams = field.length ? field : [solo.slice(0, VERSUS_TEAM)];
      for (let x = 0; x < solo.length; x++) for (let y = 0; y < solo.length; y++) for (let z = 0; z < solo.length; z++) {
        if (x === y || y === z || x === z) continue;
        const team = [solo[x], solo[y], solo[z]];
        const r = scoreFn(team, teams);
        if (!res || r.score > res.score) res = { dex: team.map((m) => m.dex), ...r };
      }
    }
    if (mem.vsCache.size > 200) mem.vsCache.clear();
    mem.vsCache.set(sig, res);
    return res;
  }

  /** Meilleure équipe pour ATTAQUER ces équipes (marge moyenne). */
  const bestVersusTeam = (save = readSave(), foes = []) =>
    searchVersusTeam(save, foes, (team, teams) => ({ score: avg(teams.map((f) => teamFight(team, f))) }), 'atk');

  /**
   * Meilleure équipe de DÉFENSE : ce sont les autres qui attaquent (on simule chaque équipe connue contre la nôtre).
   * Priorité au nombre d'attaques repoussées, puis à la marge moyenne (une défaite serrée vaut mieux qu'une déroute).
   * @returns {{dex:number[], score:number, held:number, total:number, margin:number}|null}
   */
  const bestDefenseTeam = (save = readSave(), foes = []) =>
    searchVersusTeam(save, foes, (team, teams) => {
      const m = teams.map((f) => -teamFight(f, team));
      const held = m.filter((x) => x > 0).length;
      const margin = avg(m);
      return { score: held + 0.5 * margin, held, total: teams.length, margin };
    }, 'def');

  /** Lignes d'adversaires visibles : nom, équipe (dex), bouton COMBATTRE (absent si déjà battu). */
  function versusRows() {
    const fightRe = Rt.re('ui.versus.fightName', 'Affronter {name}', { exact: true });
    const teamHead = norm(Rt.t('ui.board.theirTeam', '{name}')).split('{')[0];
    // "{name} · N.{level}" (libellé du jeu) → nom de l'espèce
    const tpl = Rt.t('ui.board.monTitle', '{name}');
    const pre = tpl.split('{name}')[0], post = (tpl.split('{name}')[1] ?? '').split('{')[0];
    const monName = (title) => { let s = title.startsWith(pre) ? title.slice(pre.length) : title; if (post && s.includes(post)) s = s.slice(0, s.indexOf(post)); return s.trim(); };
    return $$('main li').filter((li) => li.querySelector(':scope ul[aria-label]')).map((li) => {
      const ul = li.querySelector(':scope ul[aria-label]');
      const team = $$('li[title]', ul).map((x) => Rt.dexOf(monName(x.getAttribute('title')))).filter(Boolean);
      const b = $$('button[aria-label]', li).find((x) => fightRe.test(norm(x.getAttribute('aria-label'))));
      const raw = ul.getAttribute('aria-label'), pre2 = Rt.t('ui.board.theirTeam', '{name}').split('{name}')[0];
      const name = (raw.startsWith(pre2) ? raw.slice(pre2.length) : raw).trim();
      return { li, team, btn: b && enabled(b) ? b : null, name, beaten: !b, me: li.getAttribute('aria-current') === 'true' };
    }).filter((r) => r.team.length);
  }

  /** Équipe Versus enregistrée (lue sur l'onglet "Mon équipe"), en dex. */
  function readVersusTeam() {
    const ol = $$('main ol[aria-label]').find((x) => Rt.re('ui.versus.yourTeam').test(norm(x.getAttribute('aria-label'))));
    return ol ? $$(':scope > li b', ol).map((b) => Rt.dexOf(b.textContent)).filter(Boolean) : null;
  }
  /** Compose et enregistre l'équipe (onglet "Mon équipe" déjà ouvert). @returns {Promise<boolean>} */
  async function setVersusTeam(dex) {
    const want = dex.map((d) => Rt.nameOf(d));
    const clear = btn('ui.versus.clear'); if (clear) { clear.click(); await sleep(250); }
    for (const n of want) {
      const b = $$('main ul button[aria-pressed="false"]').find((x) => visible(x) && norm(x.querySelector('b')?.textContent) === norm(n));
      if (!b) { log(`⚠️ Versus : ${n} introuvable dans la liste de tes Pokémon`); return false; }
      b.click(); await sleep(200);
    }
    const saveBtn = btn('ui.versus.save');
    if (!saveBtn) return true; // "ÉQUIPE ENREGISTRÉE" : c'était déjà celle-là
    saveBtn.click();
    await waitFor(() => bodyHas('ui.versus.saved') || bodyHas('ui.versus.isSaved') || bodyHas('ui.versus.unchanged'), 3000);
    return true;
  }

  /**
   * Équipe de défense : on rassemble TOUTES les équipes connues (adversaires "à battre" et déjà battus, classement),
   * puis on enregistre celle qui repousse le plus d'attaques. Lancée par le bouton 🛡️ du panneau, ou en fin de session.
   */
  async function playVersusDefense(save, tab, onTab) {
    const D = mem.vsDefense;
    const collect = () => { for (const r of versusRows()) if (!r.me && r.team.length) D.field.set(r.name, r.team); };
    const finish = (msg) => {
      if (msg) log(msg);
      mem.vsDefense = null;
      setActState({ vsDefenseAt: Date.now(), ...(D.auto ? { vsNext: Date.now() + CONFIG.versusRecheckMin * 60e3 } : {}) });
      if (D.stopAfter) bot.stop('équipe de défense prête');
      return goHome();
    };
    if (D.stage === 'fight') {
      if (!onTab('fight')) { tab('fight')?.click(); return true; }
      // Filtre "Tous" : les équipes déjà battues peuvent elles aussi nous attaquer
      const allLabel = norm(Rt.t('ui.dex.fAll', 'Tous'));
      const all = !D.allClicked && $$('main button, main [role=radio], main [role=tab]').find((x) => visible(x) && norm(x.textContent).startsWith(allLabel) && x.getAttribute('aria-pressed') !== 'true' && x.getAttribute('aria-checked') !== 'true' && x.getAttribute('aria-selected') !== 'true');
      D.allClicked = true;
      if (all) { all.click(); return true; }
      collect();
      D.stage = 'board';
      tab('board')?.click();
      return true;
    }
    if (D.stage === 'board') {
      if (!onTab('board') && tab('board')) { tab('board').click(); return true; }
      collect();
      const foes = [...D.field.values()];
      mem.vsField = foes;
      const best = bestDefenseTeam(save, foes);
      if (!best) return finish('⚠️ Versus : il faut 3 Pokémon au N.50 pour composer une équipe de défense');
      D.best = best;
      D.stage = 'team';
      log(`🛡️ Versus : ${foes.length} équipe(s) adverse(s) connue(s) → défense ${best.dex.map((d) => Rt.nameOf(d)).join(' → ')} (repousse ${best.held}/${best.total} attaques simulées, marge moyenne ${best.margin.toFixed(2)})`);
      tab('team')?.click();
      return true;
    }
    if (D.stage === 'team') {
      if (!onTab('team')) { tab('team')?.click(); return true; }
      const cur = readVersusTeam();
      if (cur && cur.length === D.best.dex.length && cur.every((d, i) => d === D.best.dex[i])) { mem.vsMine = cur; return finish('🛡️ Versus : c’était déjà la meilleure équipe de défense'); }
      const ok = await setVersusTeam(D.best.dex);
      if (ok) mem.vsMine = D.best.dex;
      return finish(ok ? '🛡️ Versus : équipe de défense enregistrée' : '⚠️ Versus : équipe de défense non enregistrée (Pokémon introuvable dans la liste)');
    }
    return finish();
  }

  /** Bouton du panneau : compose la meilleure équipe de défense maintenant (démarre le bot le temps de le faire). */
  function requestDefenseTeam() {
    const save = readSave();
    if (!versusEligible(save)) { log(`🔒 Versus verrouillé : ${(save?.box ?? []).filter((m) => m.level >= 50).length}/3 Pokémon au N.50`); return false; }
    mem.vsDefense = { stage: 'fight', field: new Map(), stopAfter: !bot.running };
    mem.vsMine = null;
    log('🛡️ Versus : composition de l’équipe de défense…');
    navTo('/versus');
    if (!bot.running) bot.start();
    return true;
  }

  /**
   * Versus, un combat à la fois :
   *  1. pour chaque équipe "à battre", la meilleure équipe possible CONTRE ELLE (simulation 3 contre 3 au N.50) ;
   *  2. on choisit l'adversaire le plus prenable ;
   *  3. on enregistre l'équipe taillée pour lui (si elle diffère), puis on lance le combat ;
   *  4. à la fin, on remet l'équipe la plus solide face à l'ensemble des adversaires (elle sert aussi en défense).
   */
  async function playVersus() {
    const save = readSave();
    const back = btn('ui.versus.back');
    if (back) {
      const won = bodyHas('ui.versus.won.title');
      const st = actState();
      setActState({ vsWins: (st.vsWins ?? 0) + (won ? 1 : 0), vsFights: (st.vsFights ?? 0) + 1 });
      log(won ? `🏆 Versus : victoire contre ${mem.vsPlan?.name ?? '?'}` : `💀 Versus : défaite contre ${mem.vsPlan?.name ?? '?'}`);
      mem.vsPlan = null;
      back.click();
      return true;
    }
    if (readBattle()) return true; // replay : le combat est déjà décidé
    if (bodyHas('ui.versus.connect')) { setActState({ vsNext: Date.now() + 6 * 3600e3 }); log('🔐 Versus : il faut être connecté au compte du jeu (Paramètres). Nouvel essai dans 6 h.'); return goHome(); }
    if (bodyHas('ui.versus.offline') || bodyHas('ui.versus.failed')) { setActState({ vsNext: Date.now() + 30 * 60e3 }); log('⚠️ Versus indisponible pour le moment — nouvel essai dans 30 min'); return goHome(); }
    if (bodyHas('ui.common.loading') && !$$('main li').length) return true;
    const tab = (id) => document.getElementById(`vs-${id}`);
    const onTab = (id) => tab(id)?.getAttribute('aria-selected') === 'true';

    if (mem.vsDefense) return playVersusDefense(save, tab, onTab);

    // Onglet "Mon équipe" : lire l'équipe actuelle / enregistrer celle qu'on veut
    if (onTab('team')) {
      if (mem.vsNeedTeam) {
        const want = mem.vsNeedTeam;
        mem.vsNeedTeam = null;
        if (await setVersusTeam(want)) { mem.vsMine = want; log(`💾 Versus : équipe ${want.map((d) => Rt.nameOf(d)).join(' → ')}${mem.vsPlan ? ` (taillée contre ${mem.vsPlan.name})` : ' (défense)'}`); }
        else { mem.vsPlan = null; mem.vsMine = readVersusTeam(); }
      } else mem.vsMine = readVersusTeam() ?? [];
      tab('fight')?.click();
      return true;
    }
    if (!onTab('fight')) { tab('fight')?.click(); return true; }
    if (!mem.vsMine) { const t = tab('team'); if (t) { t.click(); return true; } mem.vsMine = []; }

    const rows = versusRows().filter((r) => r.btn);
    const same = (a, b) => a?.length === b?.length && a.every((d, i) => d === b[i]);
    // 1-2) Plan : meilleur couple (adversaire, équipe taillée pour lui)
    if (!mem.vsPlan) {
      let plan = null;
      for (const r of rows) {
        const foe = r.team.map(clone50).filter(Boolean);
        const best = CONFIG.versusAutoTeam ? bestVersusTeam(save, [r.team]) : null;
        const team = best?.dex ?? mem.vsMine;
        const margin = best?.score ?? (team.length ? teamFight(team.map(clone50).filter(Boolean), foe) : -1);
        if (!plan || margin > plan.margin) plan = { name: r.name, foe: r.team, team, margin };
      }
      if (!plan || plan.margin < CONFIG.versusMinMargin) {
        // Plus rien de prenable : on remet l'équipe la plus solide contre tout le monde (elle défend en notre absence)
        if (CONFIG.versusAutoTeam && !mem.vsDefenseSet) {
          mem.vsDefenseSet = true;
          mem.vsDefense = { stage: 'fight', field: new Map(), auto: true };
          log('🛡️ Versus : plus rien à attaquer → on prépare l’équipe de défense');
          return true;
        }
        setActState({ vsNext: Date.now() + CONFIG.versusRecheckMin * 60e3 });
        log(rows.length ? `⏸️ Versus : ${rows.length} équipe(s) à battre, aucune prenable même avec la meilleure équipe (marge < ${CONFIG.versusMinMargin}) — retour dans ${CONFIG.versusRecheckMin} min` : `✅ Versus : toutes les équipes sont battues — retour dans ${CONFIG.versusRecheckMin} min`);
        mem.vsDefenseSet = false;
        return goHome();
      }
      mem.vsPlan = plan;
      log(`🎯 Versus : cible ${plan.name} (${plan.foe.map((d) => Rt.nameOf(d)).join(', ')}) avec ${plan.team.map((d) => Rt.nameOf(d)).join(' → ')} — marge simulée ${plan.margin.toFixed(2)}`);
    }
    const plan = mem.vsPlan;
    // 3) Équipe taillée pour cet adversaire
    if (CONFIG.versusAutoTeam && !same(plan.team, mem.vsMine)) { mem.vsNeedTeam = plan.team; tab('team')?.click(); return true; }
    // 4) Combat
    if (Date.now() - (mem.vsLastFight ?? 0) < CONFIG.versusPauseSec * 1000) return true;
    const row = rows.find((r) => r.name === plan.name);
    if (!row) { mem.vsPlan = null; return true; } // l'adversaire a changé d'équipe ou n'est plus là
    mem.vsLastFight = Date.now();
    log(`⚔️ Versus : combat contre ${plan.name}`);
    row.btn.click();
    return true;
  }

  /* ---- Raids ---- */
  const raidCfg = () => Rt.D.config.events?.raid;
  const dailyRaidOpen = (save = readSave()) => {
    const c = raidCfg();
    if (!c?.enabled || (c.access && c.access !== 'all')) return false;
    const p = save?.areaProgress?.[c.unlockAreaId];
    return !c.unlockAreaId || !!(p?.cleared || p?.bossDefeated);
  };
  /** Raids légendaires ouverts (zone terminée) et pas encore capturés. */
  function legendaryRaids(save = readSave()) {
    const caught = new Set(save?.pokedex ?? []);
    const out = [];
    for (const a of Rt.D.areaList) {
      const p = save?.areaProgress?.[a.id];
      if (!(p?.cleared || p?.bossDefeated)) continue;
      for (const b of a.legendaryBoss ?? []) if (b.raid && !caught.has(b.dex)) out.push({ areaId: a.id, dex: b.dex, level: b.level, path: `/raid/${a.id}/${b.dex}`, key: `${a.id}/${b.dex}` });
    }
    return out;
  }
  /** Prochain raid à faire, ou null. */
  function nextRaid(save = readSave()) {
    const st = actState();
    const day = utcDay();
    const tries = st.raidTries?.day === day ? st.raidTries : { day, n: {} };
    if (CONFIG.raidDaily && dailyRaidOpen(save) && st.raidDone !== day && (tries.n.daily ?? 0) < CONFIG.raidMaxTries && !(st.raidSkip?.daily > Date.now())) return { key: 'daily', path: '/events/raid' };
    if (CONFIG.raidLegendary) for (const r of legendaryRaids(save)) if ((tries.n[r.key] ?? 0) < CONFIG.raidMaxTries && !(st.raidSkip?.[r.key] > Date.now())) return r;
    return null;
  }
  const bumpRaidTry = (key) => {
    const st = actState(); const day = utcDay();
    const tries = st.raidTries?.day === day ? st.raidTries : { day, n: {} };
    tries.n[key] = (tries.n[key] ?? 0) + 1;
    setActState({ raidTries: tries });
    return tries.n[key];
  };

  /**
   * Niveaux d'amélioration en raid (port de bB) : le jeu n'utilise PAS les améliorations du joueur.
   *  - chaque camp (toi et les alliés) attaque au niveau sideUpgradeLevel, avec l'échelle sideTypes
   *    (super efficace ×1,3, pas très efficace ×0,5, immunité ×0) ;
   *  - le boss attaque au niveau upgradeLevel, avec l'échelle bossTypes (×2 / ×0,7 / ×0,5).
   * Avant la v1.5 le bot avait inversé les deux échelles : il surestimait l'attaque et ignorait la défense.
   */
  const RAID_SIDE = { super: 1.3, resisted: 0.5, immune: 0 }, RAID_BOSS = { super: 2, resisted: 0.7, immune: 0.5 };
  function raidSideLevels() { const c = raidCfg() ?? {}; return { ...Rt.E.allLevels(c.sideUpgradeLevel ?? 5), typeScale: c.sideTypes ?? RAID_SIDE }; }
  function raidBossLevels() { const c = raidCfg() ?? {}; return { ...Rt.E.allLevels(c.upgradeLevel ?? 8), typeScale: c.bossTypes ?? RAID_BOSS }; }

  /**
   * Valeur d'un Pokémon en raid = dégâts moyens infligés au boss avant d'être K.O.
   * (dégâts moyens par tour × tours de survie), au niveau plafond du raid et avec les règles ci-dessus.
   * La défense pèse lourd : un boss super efficace frappe ×2, un boss résisté ×0,7 (ou ×0,5 si immunité).
   */
  function raidValue(dex, level, bossDex, bossLevel) {
    const c = raidCfg() ?? {};
    const me = Rt.E.speciesAt(dex, Math.min(level, c.teamCap ?? level)), boss = Rt.E.speciesAt(bossDex, bossLevel);
    if (!me || !boss) return 0;
    const myDmg = Rt.E.avgDamage(me.dice, { attackerTypes: me.types, defTypes: boss.types, levels: raidSideLevels() });
    const bossDmg = Math.max(0.1, Rt.E.avgDamage(boss.dice, { attackerTypes: boss.types, defTypes: me.types, levels: raidBossLevels() }));
    return myDmg * Math.ceil(me.maxHp / bossDmg);
  }
  /** Valeur d'une équipe d'alliés PNJ : somme des valeurs de ses Pokémon (ils combattent l'un après l'autre). */
  const raidTeamValue = (dexes, level, bossDex, bossLevel) => dexes.reduce((n, d) => n + raidValue(d, level, bossDex, bossLevel), 0);
  /** PV totaux du boss : chaque barre vaut barHp × PV max, `bars` barres. */
  function raidBossHp(bossDex, bossLevel) {
    const c = raidCfg() ?? {};
    const st = Rt.E.speciesAt(bossDex, bossLevel);
    return st ? st.maxHp * (c.barHp ?? 1) * (c.bars ?? 1) : Infinity;
  }
  /**
   * Chances estimées : dégâts attendus de tout le groupe (toi + PNJ + amis) / PV totaux du boss.
   * Les amis sont comptés comme ton équipe (leur composition n'est pas lisible à l'écran).
   */
  const raidOdds = (r) => (r.myValue ?? 0) * (1 + (r.friends ?? 0)) + (r.alliesValue ?? 0);
  /** Meilleur Pokémon à entraîner pour un raid : le plus utile au niveau plafond parmi ceux qui ne l'ont pas encore. */
  function raidTrainee(save, bossDex, bossLevel) {
    const cap = raidCfg()?.teamCap ?? 50;
    const mons = [...teamMons(save), ...boxMons(save)].filter((m) => m.stats && !m.fossil);
    const ready = mons.filter((m) => m.level >= cap).map((m) => raidValue(m.dex, cap, bossDex, bossLevel)).sort((a, b) => b - a);
    const bar = ready[2] ?? 0; // le 3e meilleur Pokémon déjà au plafond
    let best = null;
    for (const m of mons) {
      if (m.level >= cap) continue;
      const v = raidValue(m.dex, cap, bossDex, bossLevel);
      if (v > bar && (!best || v > best.v)) best = { m, v };
    }
    return best;
  }

  /**
   * Équipe de raid : à chaque raid, le bot ouvre "Modifier" et choisit les 3 Pokémon qui infligeront le plus de
   * dégâts au boss avant d'être K.O. (parmi ceux que le jeu propose, au niveau plafond du raid), meilleur en tête.
   */
  async function ensureRaidTeam(r) {
    if (r.teamDone || !CONFIG.raidAutoTeam) return false;
    const d = dialog();
    const saveBtn = d && btn('ui.raid.teamSave', { scope: d });
    if (saveBtn) {
      const picks = $$('button[aria-pressed]', d).filter((x) => visible(x) && x.querySelector('b'));
      const keyOf = (x) => norm(x.textContent);
      if (!r.teamPlan) {
        if (!r.dex) { log('⚠️ Raid : boss inconnu, équipe de raid laissée telle quelle'); r.teamDone = true; closeDialog(); return true; }
        const bossLevel = r.bossLevel ?? raidCfg()?.level ?? 50;
        const scored = picks.map((x) => {
          const dex = Rt.dexOf(x.querySelector('b').textContent);
          const lvl = +(norm(x.textContent).match(/N\.\s*(\d+)/)?.[1] ?? 1);
          return { key: keyOf(x), name: x.querySelector('b').textContent, v: dex ? raidValue(dex, lvl, r.dex, bossLevel) : 0 };
        }).sort((a, b) => b.v - a.v).slice(0, 3);
        r.teamPlan = scored.map((x) => x.key);
        r.teamNames = scored.map((x) => x.name);
        r.myValue = scored.reduce((n, x) => n + x.v, 0);
        r.rebuild = true;
      }
      const pressed = picks.filter((x) => x.getAttribute('aria-pressed') === 'true');
      // On repart de zéro une fois (pour que l'ordre soit le bon : le meilleur mène)
      if (r.rebuild && pressed.length) { pressed[0].click(); return true; }
      r.rebuild = false;
      const have = pressed.map(keyOf);
      // prochain Pokémon du plan pas encore choisi (les doublons d'espèce/niveau sont comptés)
      const left = [...have];
      const next = r.teamPlan.find((k) => { const i = left.indexOf(k); if (i >= 0) { left.splice(i, 1); return false; } return true; });
      if (next && have.length < 3) {
        const b = picks.find((x) => x.getAttribute('aria-pressed') !== 'true' && keyOf(x) === next);
        if (b) { b.click(); return true; }
      }
      r.teamDone = true;
      saveBtn.click();
      log(`🐉 Raid : équipe ${r.teamNames.join(' → ')} contre ${Rt.nameOf(r.dex)}`);
      return true;
    }
    const sec = document.querySelector('section[aria-labelledby="raid-team-h"]');
    if (!sec) return false;
    const edit = btn('ui.raid.teamEdit', { scope: sec });
    if (edit) { edit.click(); return true; }
    r.teamDone = true;
    return false;
  }

  /**
   * Amis dans le groupe : « Ajouter un ami » → la liste des amis qui ont une équipe de raid.
   * Leurs Pokémon ne sont lisibles qu'en image ; le jeu marque d'un badge ceux qui sont recommandés
   * (niveau suffisant et super efficaces contre le boss) : on prend l'ami qui en a le plus.
   */
  async function ensureRaidFriends(r) {
    if (!CONFIG.raidFriends || r.friendsDone) return false;
    const d = dialog();
    if (d && norm(d.innerText).includes(norm(Rt.t('ui.raid.friendsTitle')))) {
      if (bodyHas('ui.common.loading') && (r.friendWait = (r.friendWait ?? 0) + 1) < 20) return true;
      const rows = $$('li button[aria-pressed]', d).filter((x) => visible(x) && enabled(x) && x.getAttribute('aria-pressed') !== 'true');
      const badges = (x) => $$('span.relative', x).filter((sp) => sp.children.length > 1).length;
      const best = rows.map((x) => ({ x, n: badges(x), name: x.querySelector('b')?.innerText.trim() ?? '?' })).sort((a, b) => b.n - a.n)[0];
      if (best) { r.friends = (r.friends ?? 0) + 1; log(`👥 Raid : ${best.name} rejoint le groupe (${best.n} Pokémon recommandé${best.n > 1 ? 's' : ''})`); best.x.click(); return true; }
      r.friendsDone = true; closeDialog(); return true;
    }
    const sec = document.querySelector('section[aria-labelledby="raid-group-h"]');
    const add = sec && $$('button', sec).find((x) => visible(x) && enabled(x) && norm(x.querySelector('b')?.innerText ?? '') === norm(Rt.t('ui.raid.addFriend')));
    if (!add || (r.friendTries = (r.friendTries ?? 0) + 1) > 3) { r.friendsDone = true; return false; }
    add.click();
    return true;
  }

  async function playRaidPage() {
    const path = location.pathname;
    const r = mem.raid ?? (mem.raid = { key: path.startsWith('/raid/') ? path.split('/').slice(2).join('/') : 'daily', dex: +path.split('/')[3] || null, idle: 0 });
    // Raid du jour : l'espèce se lit sur la page (premier nom de Pokémon affiché)
    if (!r.dex) for (const line of (document.querySelector('main')?.innerText ?? '').split('\n')) { const d = Rt.dexOf(line.trim()) ?? Rt.dexOf(line.replace(/^.*?:\s*/, '').trim()); if (d) { r.dex = d; break; } }
    // Intro du raid : GO !
    const goBtn = btn(['ui.raid.intro.go', 'ui.raid.intro.skip']);
    if (goBtn) { goBtn.click(); return true; }
    // Combat en cours : tour des alliés / riposte du boss → on accélère les alliés et on attend (ce n'est pas de l'inactivité)
    if (readBattle()) {
      r.idle = 0;
      mem.fightKind = 'raid';
      mem.rare = { dex: r.dex, why: 'raid' };
      const speed = $$('button[aria-pressed="false"]').find((x) => visible(x) && norm(x.getAttribute('aria-label')) === norm(Rt.t('ui.raid.speed', '§')));
      if (speed && !r.sped) { r.sped = true; speed.click(); log('⏩ Raid : tours des alliés accélérés'); }
      return true;
    }
    // Choix des PNJ alliés : les plus super efficaces contre le boss
    const cardRe = Rt.re('ui.raid.npcPick.card', '{name} : {team}, N.{level}');
    const cards = $$('button[aria-label]').filter((x) => visible(x) && cardRe.test(norm(x.getAttribute('aria-label'))));
    if (cards.length) {
      const startBtn = btn('ui.raid.npcStart');
      if (startBtn) {
        const odds = r.dex && r.myValue != null ? raidOdds(r) / raidBossHp(r.dex, r.bossLevel ?? raidCfg()?.level ?? 50) : null;
        r.odds = odds; r.alliesValue = 0; // le prochain essai repart d'un nouveau choix d'alliés
        log(`🤝 Raid : alliés choisis, c'est parti${odds != null ? ` (dégâts estimés ≈ ${Math.round(odds * 100)} % des PV du boss)` : ''}`);
        startBtn.click(); return true;
      }
      const bossLevel = r.bossLevel ?? raidCfg()?.level ?? 50;
      const scored = cards.filter((x) => x.getAttribute('aria-pressed') !== 'true').map((x) => {
        const label = x.getAttribute('aria-label');
        const level = +(label.match(/N\.\s*(\d+)\s*$/)?.[1] ?? label.match(/(\d+)\s*$/)?.[1] ?? bossLevel);
        const teamTxt = label.split(':').slice(1).join(':').replace(/,\s*N\.\s*\d+.*$/, '');
        const dexes = teamTxt.split(',').map((n) => Rt.dexOf(n.trim())).filter(Boolean);
        return { x, name: label.split(':')[0].trim(), s: r.dex ? raidTeamValue(dexes, level, r.dex, bossLevel) : dexes.length };
      }).sort((a, b) => b.s - a.s);
      if (scored[0]) { r.alliesValue = (r.alliesValue ?? 0) + (r.dex ? scored[0].s : 0); log(`🤝 Raid : allié ${scored[0].name} (≈ ${Math.round(scored[0].s)} dégâts au boss)`); scored[0].x.click(); return true; }
    }
    // Résultats
    if (btn('ui.raid.again') && (bodyHas('ui.raid.result.lostTitle') || lineHas('ui.raid.result.fledTitle'))) {
      const n = bumpRaidTry(r.key);
      if (bodyHas('ui.raid.result.lostTitle')) Stats.add('raidsLost');
      // Défaite nette prévue par l'estimation : inutile d'enchaîner les essais, on s'entraîne
      if (bodyHas('ui.raid.result.lostTitle') && r.odds != null && r.odds < CONFIG.raidMinOdds && n >= 2) {
        const st = actState();
        setActState({ raidSkip: { ...st.raidSkip, [r.key]: Date.now() + msToUtcMidnight() }, ...(CONFIG.raidTrain && r.dex && { raidTrain: { dex: r.dex, level: r.bossLevel ?? raidCfg()?.level ?? 50, until: Date.now() + 7 * 864e5 } }) });
        log(`🛑 Raid : ${n} défaites, dégâts estimés ${Math.round(r.odds * 100)} % des PV du boss (< ${Math.round(CONFIG.raidMinOdds * 100)} %) → on arrête pour aujourd'hui${CONFIG.raidTrain ? ' et on entraîne un contre au Centre' : ''}`);
        mem.raid = null; return goHome();
      }
      if (n >= CONFIG.raidMaxTries) { log(`🛑 Raid : ${n} essais sans capture aujourd'hui — on s'entraîne et on revient demain`); mem.raid = null; return goHome(); }
      log(`🔁 Raid : essai ${n + 1}/${CONFIG.raidMaxTries}`);
      btn('ui.raid.again').click();
      return true;
    }
    if (lineHas('ui.raid.result.caught') || bodyHas('ui.events.raid.caught') || (r.dex && (readSave()?.pokedex ?? []).includes(r.dex) && r.key !== 'daily')) {
      if (r.key === 'daily') setActState({ raidDone: utcDay() });
      Stats.add('raidsWon');
      if (actState().raidTrain?.dex === r.dex) setActState({ raidTrain: null });
      log(`🎉 Raid terminé (${r.dex ? Rt.nameOf(r.dex) : 'raid du jour'})`);
      notify('Raid réussi', r.dex ? Rt.nameOf(r.dex) : 'raid du jour');
      mem.raid = null;
      const b = btn(['ui.raid.back', 'ui.common.continue']); if (b) { b.click(); return true; }
      return goHome();
    }
    if (await ensureRaidTeam(r)) return true;
    if (await ensureRaidFriends(r)) return true;
    // Page du raid : lancer
    const start = btn(['ui.events.raid.start', 'ui.raid.progress.go', 'ui.raid.npcStart']);
    if (start) {
      mem.fightKind = 'raid';
      mem.rare = { dex: r.dex, why: 'raid' };
      log(`🐉 Raid : lancement${r.dex ? ' — ' + Rt.nameOf(r.dex) : ''}`);
      start.click();
      return true;
    }
    if (bodyHas('ui.raid.cantStart')) { log('⚠️ Raid : le jeu refuse de commencer (équipe de raid vide ?) — compose-la une fois sur la page du raid'); bumpRaidTry(r.key); mem.raid = null; return goHome(); }
    if (++r.idle > 40) { log('⚠️ Raid : écran inattendu, on revient plus tard'); bumpRaidTry(r.key); mem.raid = null; return goHome(); }
    return false;
  }

  /**
   * Point d'entrée (entre deux rencontres, comme les courses) : part vers l'activité si elle est due.
   * @returns {Promise<boolean>} true si on a navigué
   */
  async function activityTick() {
    const save = readSave();
    const st = actState();
    if (CONFIG.activity === 'versus') {
      if (!versusEligible(save)) { const n = (save?.box ?? []).filter((m) => m.level >= 50).length; actLog('vs', `🔒 Versus verrouillé : ${n}/3 Pokémon au N.50 — le bot joue en ${MODES[CONFIG.mode].label} en attendant`); return false; }
      if ((st.vsNext ?? 0) > Date.now()) return false;
      mem.vsMine = null; mem.vsPlan = null; mem.vsNeedTeam = null; mem.vsDefenseSet = false; mem.vsDefense = null;
      log('⚔️ Versus : on y va');
      return navTo('/versus');
    }
    if (CONFIG.activity === 'raid') {
      const r = nextRaid(save);
      if (!r) {
        const c = raidCfg();
        const why = !dailyRaidOpen(save) ? `raid du jour verrouillé (termine ${Rt.areaLabel(Rt.D.areas[c?.unlockAreaId])})` : 'raids du jour faits';
        actLog('raid', `🔒 Raids : ${why} — le bot joue en ${MODES[CONFIG.mode].label} en attendant`);
        return false;
      }
      mem.raid = { key: r.key, dex: r.dex ?? null, bossLevel: r.level, idle: 0 };
      log(`🐉 Raid : cap sur ${r.key === 'daily' ? 'le raid du jour' : Rt.nameOf(r.dex)}`);
      return navTo(r.path);
    }
    return false;
  }

  /* ── 6.12 Routines : Roue de la fortune, Revanche du Conseil 4, Pension ──
   * Une « course » (mem.errand) emmène le bot sur une page hors mode solo, s'y déroule, puis revient à l'accueil.
   * Elles passent entre deux rencontres, avant les activités (Versus / Raids) et les achats.
   */
  const ERRAND_PATH = { wheel: '/events/wheel', rebattle: '/events/rebattle', dayCare: '/daycare' };
  /** Événement ouvert à tous (config.events[id] : access "all", ou ancien format enabled) et zone de déblocage terminée. */
  function eventOpen(id, save = readSave()) {
    const c = Rt.D.config.events?.[id];
    if (!c || (c.access ? c.access !== 'all' : !c.enabled)) return false;
    if (!c.unlockAreaId) return true;
    const p = save?.areaProgress?.[c.unlockAreaId];
    return !!(p?.cleared || p?.bossDefeated);
  }
  const wheelDue = (save) => CONFIG.eventWheel && eventOpen('wheel', save) && actState().wheelDone !== utcDay();

  /* Revanche du Conseil 4 (paliers bronze → diamant, 5 combats sans Centre) */
  const rebattleTiers = () => Rt.D.config.events?.rebattle?.tiers ?? [];
  function rebattleState(save = readSave()) {
    const region = regionId(save);
    const reg = Rt.D.regions[region];
    const league = reg?.leagueAreaId && save?.areaProgress?.[reg.leagueAreaId];
    const lineups = Rt.D.config.rebattleLineups?.[region] ?? {};
    const tiers = rebattleTiers();
    if (!tiers.length || !tiers.every((t) => (lineups[t.id] ?? []).length) || !(league?.cleared || league?.bossDefeated)) return null;
    const st = save?.events?.rebattle?.[region] ?? { done: 0, step: 0 };
    if (st.done >= tiers.length) return null;
    const tier = tiers[st.done];
    return { region, tier, step: st.step ?? 0, trainers: lineups[tier.id].map((id) => Rt.D.trainers[id]).filter(Boolean) };
  }
  /** Duels de l'équipe contre les Pokémon restants du palier (améliorations adverses + upgradeDelta, "max" = niveau max). */
  function rebattleMatchup(rb, mons) {
    const ready = mons.filter((m) => m.stats);
    const maxUp = Math.max(1, ...Object.values(Rt.D.comboUp).map((l) => l.length));
    const rows = [];
    for (const tr of rb.trainers.slice(rb.step)) for (const tm of tr.team ?? []) {
      const st = Rt.E.speciesAt(tm.dex, tm.level ?? 50);
      if (!st) continue;
      const base = tr.upgradeLevel ?? Rt.D.config.enemyUpgradeLevel ?? 1;
      const up = rb.tier.upgradeDelta === 'max' ? maxUp : Math.min(maxUp, base + (+rb.tier.upgradeDelta || 0));
      let best = 0;
      for (const m of ready) best = Math.max(best, Rt.E.duelScore({ stats: m.stats, hp: m.maxHp, levels: m.levels }, { stats: st, hp: st.maxHp, levels: Rt.E.allLevels(up) }).score);
      rows.push(Math.min(4, best));
    }
    if (!rows.length) return null;
    return { avg: rows.reduce((a, b) => a + b, 0) / rows.length, worst: Math.min(...rows) };
  }
  function rebattleDue(save) {
    if (!CONFIG.rebattle || !eventOpen('rebattle', save)) return false;
    const st = actState();
    if (st.rebattleFails?.day === utcDay() && st.rebattleFails.n >= CONFIG.rebattleMaxTries) return false;
    const rb = rebattleState(save);
    if (!rb) return false;
    const mu = rebattleMatchup(rb, teamMons(save));
    const ok = !!mu && mu.avg >= CONFIG.rebattleReadyScore && mu.worst >= CONFIG.bossWorstScore;
    const sig = `${rb.tier.id}|${ok}`;
    if (mem.rebattleSig !== sig) { mem.rebattleSig = sig; log(ok ? `🏅 Revanche ${rb.tier.id} : équipe prête (duel moyen ${mu.avg.toFixed(2)})` : `🏅 Revanche ${rb.tier.id} : pas encore (duel moyen ${mu ? mu.avg.toFixed(2) : '?'} / ${CONFIG.rebattleReadyScore})`); }
    return ok;
  }
  function noteRebattleLoss() {
    const st = actState(); const day = utcDay();
    const f = st.rebattleFails?.day === day ? st.rebattleFails : { day, n: 0 };
    f.n++; setActState({ rebattleFails: f });
    return f.n;
  }

  /* Pension : groupes Œuf (port de qb) et choix du couple à déposer */
  const eggInfo = (dex) => Rt.D.eggGroups?.[dex] ?? null;
  const isDitto = (dex) => (eggInfo(dex)?.g ?? []).includes('Ditto');
  /** Deux espèces peuvent-elles faire un Œuf ? (Métamorph avec tous sauf les légendaires ; sinon groupe commun, sexes compatibles) */
  function canBreed(a, b) {
    if (isDitto(a) || isDitto(b)) return eggInfo(a)?.l !== 1 && eggInfo(b)?.l !== 1;
    const x = eggInfo(a), y = eggInfo(b);
    if (!x || !y || x.g.includes('Undiscovered') || y.g.includes('Undiscovered') || x.s === 'N' || y.s === 'N' || (x.s && x.s === y.s)) return false;
    return x.g.some((g) => y.g.includes(g));
  }
  const dayCareOf = (save) => save?.dayCare ?? { residents: [], guests: [] };
  const dayCareOpen = (save) => (save?.pokedex?.length ?? 0) >= (Rt.D.config.dayCare?.unlockPokedex ?? 20);
  /**
   * Pokémon de la Boîte à déposer pour former un couple (les plus bas niveaux : ils gagnent de l'XP là-bas).
   * Jamais l'équipe, un fossile, un chromatique ni les N meilleurs niveaux (candidats du Centre).
   * @returns {{id, dex, level, name}|null}
   */
  function dayCarePick(save) {
    const dc = dayCareOf(save);
    const slots = Rt.D.config.dayCare?.slots ?? 2;
    const res = dc.residents ?? [];
    if (res.length >= slots) return null;
    const resDex = res.map((r) => r.inst?.dex);
    if (resDex.some((a, i) => resDex.some((b, j) => i < j && canBreed(a, b)))) return null;
    const inTeam = new Set(save?.team ?? []);
    const keep = new Set(boxMons(save).filter((m) => m.stats && !m.fossil).sort((a, b) => b.level - a.level).slice(0, CONFIG.centerMaxBox).map((m) => m.id));
    const pool = (save?.box ?? []).filter((m) => !inTeam.has(m.id) && !keep.has(m.id) && m.revivesAt == null && !m.shiny && eggInfo(m.dex)).sort((a, b) => a.level - b.level);
    const view = (m) => m && { id: m.id, dex: m.dex, level: m.level, name: Rt.nameOf(m.dex) };
    if (resDex.length) return view(pool.find((m) => resDex.some((d) => canBreed(d, m.dex)))) ?? null;
    // Personne : le premier d'un couple possible (son partenaire suit aussitôt)
    for (const a of pool) if (pool.some((b) => b !== a && canBreed(a.dex, b.dex))) return view(a);
    return null;
  }
  function dayCareDue(save) {
    if (!CONFIG.dayCare || !dayCareOpen(save)) return false;
    if (dayCareOf(save).egg) return true;
    if (Date.now() - (mem.dayCareAt ?? 0) < CONFIG.dayCareCheckMin * 60000) return false;
    return !!dayCarePick(save);
  }

  /** Lance une course si elle est due (appelé entre deux rencontres). */
  async function errandTick(save) {
    if (mem.errand) {
      // Course en cours mais on est ailleurs (retour à l'accueil, fin d'un combat de la revanche…) : on y retourne
      if (location.pathname === ERRAND_PATH[mem.errand]) return false;
      if (Date.now() - (mem.errandAt ?? 0) > 120000) { log(`⚠️ ${mem.errand} : course abandonnée`); mem.errand = null; return false; }
      if (Date.now() - (mem.errandAt ?? 0) < 8000) return false;
      return navTo(ERRAND_PATH[mem.errand]);
    }
    const due = wheelDue(save) ? 'wheel' : dayCareDue(save) ? 'dayCare' : rebattleDue(save) ? 'rebattle' : null;
    if (!due) return false;
    mem.errand = due; mem.errandAt = Date.now();
    log({ wheel: '🎡 Roue de la fortune : tour gratuit du jour', dayCare: '🥚 Pension : on y passe', rebattle: '🏅 Revanche du Conseil 4 : on y va' }[due]);
    return navTo(ERRAND_PATH[due]);
  }
  function endErrand(msg) {
    if (msg) log(msg);
    if (mem.errand === 'dayCare') mem.dayCareAt = Date.now();
    mem.errand = null; mem.dcPick = null; mem.dcDone = 0;
    return goHome();
  }

  async function playErrand() {
    if (Date.now() - (mem.errandAt ?? 0) > 120000 && !readBattle()) {
      if (mem.errand === 'wheel') setActState({ wheelDone: utcDay() }); // roue injoignable (compte non connecté ?) : on réessaiera demain
      return endErrand(`⚠️ ${mem.errand} : rien ne bouge depuis 2 min, on revient`);
    }
    if (mem.errand === 'wheel') return playWheel();
    if (mem.errand === 'dayCare') return playDayCare();
    if (mem.errand === 'rebattle') return playRebattlePage();
    return false;
  }

  async function playWheel() {
    const d = dialog();
    const nice = d && btn('ui.events.wheel.nice', { scope: d });
    if (nice) { log(`🎡 Roue : ${norm(d.innerText).slice(0, 80)}`); nice.click(); return true; }
    const spin = btn('ui.events.wheel.spin');
    if (spin && enabled(spin)) { mem.errandAt = Date.now(); Stats.add('spins'); spin.click(); return true; }
    if (bodyHas('ui.events.wheel.comeBack') || bodyHas('ui.events.wheel.spentElsewhere') || bodyHas('ui.events.wheel.error')) {
      setActState({ wheelDone: utcDay() });
      return endErrand('🎡 Roue : fait pour aujourd’hui');
    }
    return true; // "Connexion…" : on attend (borné à 2 min par playErrand)
  }

  async function playRebattlePage() {
    if (encounterKind() || readBattle()) return false; // le combat s'ouvre : les politiques habituelles jouent
    const go = btn(['ui.events.rebattle.start', 'ui.events.rebattle.continue']);
    if (go && enabled(go)) { mem.fightKind = 'gym'; mem.errandAt = Date.now(); log(`🏅 Revanche : ${norm(go.innerText)}`); go.click(); return true; }
    return endErrand(bodyHas('ui.events.rebattle.allCleared') ? '🏅 Revanche : tous les paliers sont terminés' : '🏅 Revanche : rien à lancer pour l’instant');
  }
  /** Écrans de fin propres à la revanche (victoire, médaille, défaite). @returns {boolean} */
  function playRebattleEnd() {
    const d = dialog();
    const scope = d ?? document;
    if (bodyHas('ui.wipe.title') && bodyHas('ui.events.rebattle.lostBody')) {
      mem.errandAt = Date.now();
      const n = noteRebattleLoss();
      const stop = n >= CONFIG.rebattleMaxTries;
      const b = stop ? btn('ui.events.rebattle.later', { scope }) : btn('ui.wipe.tryAgain', { scope });
      if (b) {
        log(stop ? `🏅 Revanche : ${n} défaites aujourd'hui, on reprendra demain` : `🏅 Revanche : défaite ${n}/${CONFIG.rebattleMaxTries}, on recommence`);
        if (stop) mem.errand = null;
        b.click(); return true;
      }
    }
    const great = btn('ui.events.rebattle.great', { scope });
    if (great) { mem.errandAt = Date.now(); log('🏅 Revanche : palier terminé !'); notify('Revanche : palier terminé'); great.click(); return true; }
    const next = btn('ui.events.rebattle.nextFight');
    if (next) { mem.errandAt = Date.now(); Stats.add('rebattleWins'); next.click(); return true; }
    const back = btn('ui.events.rebattle.backToPage');
    if (back) { mem.errandAt = Date.now(); Stats.add('rebattleWins'); back.click(); return true; }
    return false;
  }

  async function playDayCare() {
    const d = dialog();
    // Éclosion : animation (Échap la passe), puis un bouton pour fermer
    if (d && norm(d.getAttribute('aria-label')) === norm(Rt.t('ui.dayCare.eggHatching'))) {
      mem.errandAt = Date.now();
      const done = lineHas('ui.dayCare.hatched') || lineHas('ui.dayCare.hatchedShiny');
      const b = $$('button', d).filter((x) => visible(x) && enabled(x)).at(-1);
      if (done && b) {
        const shiny = lineHas('ui.dayCare.hatchedShiny');
        const txt = $$('p', d).map((x) => x.innerText).join(' ').replace(/\s+/g, ' ').slice(0, 140);
        Stats.add('eggs'); if (shiny) { Stats.add('shinyEggs'); notify('Œuf chromatique !', txt); }
        log(`🐣 ${txt}`);
        b.click(); return true;
      }
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    }
    const hatch = btn('ui.dayCare.hatchIt');
    if (hatch) { mem.errandAt = Date.now(); log('🥚 Pension : un Œuf attend → éclosion'); hatch.click(); return true; }
    // Choix du Pokémon à laisser
    if (d && mem.dcPick) {
      const p = mem.dcPick;
      const lv = norm(Rt.t('ui.common.level.short', 'N.{n}').replace('{n}', p.level));
      const row = $$('li button', d).find((x) => visible(x) && enabled(x) && norm(x.querySelector('b')?.innerText ?? '').startsWith(norm(p.name)) && norm(x.innerText).includes(lv));
      if (row) { log(`🏡 Pension : ${p.name} ${lv} y reste (couple pour les Œufs, XP en plus)`); row.click(); mem.dcPick = null; mem.dcDone = (mem.dcDone ?? 0) + 1; return true; }
      log(`⚠️ Pension : ${p.name} ${lv} introuvable dans la liste`); closeDialog(); return endErrand();
    }
    const save = readSave();
    const pick = (mem.dcDone ?? 0) < 2 ? dayCarePick(save) : null;
    const slot = pick && $$('button').find((x) => visible(x) && enabled(x) && norm(x.querySelector('b')?.innerText ?? '') === norm(Rt.t('ui.dayCare.leaveOne')));
    if (slot) { mem.dcPick = pick; mem.errandAt = Date.now(); slot.click(); return true; }
    const res = dayCareOf(save).residents ?? [];
    return endErrand(res.length ? `🏡 Pension : ${res.map((r) => Rt.nameOf(r.inst?.dex)).join(' + ')}` : null);
  }

  /* ── 6.10 Évolutions par objet : Équipe → fiche du Pokémon → UTILISER UN OBJET → la Pierre ── */
  function startItemEvolution(save) {
    mem.evolveTried ??= new Set();
    const t = itemEvolutions(save).find((x) => x.owned > 0 && !mem.evolveTried.has(`${x.mon.id}>${x.toDex}`));
    if (!t) return false;
    mem.evolve = { ...t, steps: 0 };
    log(`💎 évolution par objet : ${t.mon.name} N.${t.mon.level} + ${Rt.t('item.' + t.item, t.item)} → ${Rt.nameOf(t.toDex)}`);
    return go('/team');
  }

  async function playItemEvolution() {
    const ev = mem.evolve;
    const done = (ok) => {
      mem.evolveTried.add(`${ev.mon.id}>${ev.toDex}`);
      mem.evolve = null;
      log(ok ? `✨ ${ev.mon.name} a évolué en ${Rt.nameOf(ev.toDex)} (nouvelle entrée au Pokédex)` : `⚠️ évolution de ${ev.mon.name} abandonnée (écran inattendu)`);
      closeDialog(); go('/home');
      return true;
    };
    if (++ev.steps > 12) return done(false);
    // 1) animation d'évolution
    const skip = btn(['ui.evolution.skip', 'ui.evolution.next']);
    if (skip && (bodyHas('ui.evolution.evolving') || bodyHas('ui.evolution.evolved'))) { skip.click(); await sleep(300); return done(true); }
    if ((readSave()?.pokedex ?? []).includes(ev.toDex)) return done(true);
    const d = dialog();
    // 2) panneau "Utiliser un objet" : le bouton de l'objet ("Pierre Lune · Le fait évoluer en …")
    if (d && Rt.re('ui.itemPanel.title').test(norm(d.innerText.split('\n')[0]))) {
      const it = $$('button', d).find((x) => visible(x) && enabled(x) && norm(x.innerText).startsWith(itemName(ev.item)));
      if (!it) return done(false);
      it.click();
      return true;
    }
    // 3) fiche du Pokémon : bouton UTILISER UN OBJET (ou FAIRE ÉVOLUER au niveau max)
    if (d && norm(d.innerText).startsWith(norm(ev.mon.name))) {
      const use = btn('ui.itemPanel.title', { scope: d });
      if (use) { use.click(); return true; }
      return done(false);
    }
    if (d) closeDialog();
    // 4) carte du Pokémon dans Équipe / Boîte ("Mélofée N.10")
    const lvl = new RegExp(`N\\.?\\s*${ev.mon.level}\\b|LV\\.?\\s*${ev.mon.level}\\b`);
    const card = $$('main button').find((x) => visible(x) && norm(x.innerText).startsWith(norm(ev.mon.name)) && lvl.test(norm(x.innerText)))
      ?? $$('main button').find((x) => visible(x) && norm(x.innerText).startsWith(norm(ev.mon.name)));
    if (!card) return done(false);
    card.click();
    return true;
  }

  /* ── 6.9 Économie : registre, Boutique (achat + revente), Améliorations ── */
  const badgeCount = (save) => save?.badges?.length ?? Object.values(save?.areaProgress ?? {}).reduce((n, p) => n + (p.gymsDefeated?.length ?? 0), 0);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const priceOf = (key) => Rt.D.items[key]?.price ?? Infinity;
  const FAMILY_OF_KIND = { heal: 'heal', ball: 'ball', cure: 'cure', rerolls: 'ether', bait: 'bait', fossil: 'fossil' };
  const familyOf = (key) => FAMILY_OF_KIND[Rt.D.items[key]?.effect?.kind] ?? (isEvolutionItem(key) ? 'stone' : 'other');
  const isEvolutionItem = (key) => { mem.evoItems ??= new Set(Object.values(Rt.D.species).flatMap((s) => (s.evolutions ?? []).map((e) => e.item).filter(Boolean))); return mem.evoItems.has(key); };

  /**
   * Registre financier (localStorage) : d'où vient l'or, où il part, ce qui est consommé.
   * Le bot attribue ses propres achats / ventes ; tout autre écart d'or est un gain (combats) ou une "autre" dépense,
   * toute baisse d'inventaire hors boutique est une consommation (soins, Balls…).
   */
  const LEDGER_KEY = 'pokebot.ledger';
  const Ledger = {
    d: null, dirtyAt: 0,
    blank() { return { since: Date.now(), income: 0, other: 0, sold: 0, spent: {}, used: {}, enc: 0, hist: [], gold: null, inv: null, lastReport: Date.now() }; },
    load() { try { this.d = JSON.parse(localStorage.getItem(LEDGER_KEY)); } catch {} if (!this.d?.spent) this.d = this.blank(); return this.d; },
    data() { return this.d ?? this.load(); },
    save() { try { localStorage.setItem(LEDGER_KEY, JSON.stringify(this.d)); } catch {} this.dirtyAt = 0; },
    reset() { this.d = this.blank(); const s = readSave(); this.d.gold = s?.gold ?? null; this.d.inv = { ...(s?.inventory ?? {}) }; this.save(); },
    /** @param why  {spend:famille} | {sell:true} | {buy:true} pour les mouvements faits par le bot */
    observe(save, why = null) {
      if (!save) return;
      const d = this.data();
      const g = save.gold ?? 0;
      if (d.gold != null && g !== d.gold) {
        const delta = g - d.gold;
        if (why?.spend) d.spent[why.spend] = (d.spent[why.spend] ?? 0) + Math.max(0, -delta);
        else if (why?.sell) d.sold += Math.max(0, delta);
        else if (delta > 0) d.income += delta; else d.other += -delta;
        this.dirtyAt ||= Date.now();
      }
      d.gold = g;
      const inv = save.inventory ?? {};
      if (d.inv && !why) {
        for (const [k, n] of Object.entries(d.inv)) {
          const now = inv[k] ?? 0;
          if (now < n) { const f = familyOf(k); d.used[f] = (d.used[f] ?? 0) + (n - now); this.dirtyAt ||= Date.now(); }
        }
      }
      d.inv = { ...inv };
      if (this.dirtyAt && Date.now() - this.dirtyAt > 5000) this.save();
    },
    encounter() {
      const d = this.data();
      d.enc++;
      if (d.enc % 10 === 0) { d.hist.push({ enc: d.enc, used: { ...d.used }, income: d.income, t: Date.now() }); if (d.hist.length > 30) d.hist.shift(); }
      this.save();
    },
    /** Consommation d'une famille par rencontre, sur les ~rateWindow dernières (null tant qu'on manque de données). */
    rate(fam) {
      const d = this.data();
      const ref = d.hist.find((h) => d.enc - h.enc <= CONFIG.rateWindow) ?? null;
      const base = ref && d.enc - ref.enc >= 15 ? ref : d.enc >= 15 ? { enc: 0, used: {} } : null;
      if (!base) return null;
      return ((d.used[fam] ?? 0) - (base.used[fam] ?? 0)) / (d.enc - base.enc);
    },
    perHour() { const d = this.data(); const h = Math.max(1 / 60, (Date.now() - d.since) / 3600000); return { income: d.income / h, hours: h }; },
    summary() {
      const d = this.data();
      const { income, hours } = this.perHour();
      const spentTotal = Object.values(d.spent).reduce((a, b) => a + b, 0);
      const fam = Object.entries(d.spent).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FAMILY_LABEL[k] ?? k} ₽${v}`).join(', ');
      const use = ['heal', 'ball'].map((f) => { const r = this.rate(f); return `${FAMILY_LABEL[f]} ${r == null ? '?' : r.toFixed(2)}/renc.`; }).join(' · ');
      return { hours, income: d.income, perHour: income, spentTotal, sold: d.sold, other: d.other, enc: d.enc, fam, use, net: d.income + d.sold - spentTotal - d.other };
    },
    report(force = false) {
      const d = this.data();
      if (!force && Date.now() - d.lastReport < CONFIG.reportMinutes * 60000) return;
      d.lastReport = Date.now();
      const s = this.summary();
      log(`📊 bilan ${s.hours.toFixed(1)} h : gagné ₽${s.income} (₽${Math.round(s.perHour)}/h, ${s.enc} rencontres) · dépensé ₽${s.spentTotal}${s.fam ? ' [' + s.fam + ']' : ''} · revendu ₽${s.sold} · net ${s.net >= 0 ? '+' : ''}₽${s.net} · conso ${s.use}`);
      this.save();
    },
  };
  const FAMILY_LABEL = { heal: 'soins', ball: 'Balls', rareBall: 'Balls rares', cure: 'remèdes', ether: 'Huiles', stone: 'objets d’évolution', bait: 'appâts', fossil: 'fossiles', upgrade: 'améliorations', general: 'Général', other: 'autres' };

  /** Objet coupé par le jeu (config.itemSwitches : "off" ou réservé aux admins) — ex. l'Appât. */
  const itemOn = (key) => !['off', 'admin'].includes(Rt.D.config.itemSwitches?.[key]);

  /**
   * Fossiles qui donneraient une espèce pas encore obtenue : en vente (achat direct → Boîte, réveil en 24 h)
   * ou trouvables dans une zone (objet du lootPool).
   * @returns {{key:string, dex:number, price:number, inShop:boolean, areas:string[]}[]}
   */
  function fossilTargets(save) {
    const got = obtainedDex(save);
    const region = regionId(save);
    const badges = badgeCount(save);
    const out = [];
    for (const it of Object.values(Rt.D.items)) {
      const dex = it.effect?.kind === 'fossil' ? it.effect.dex : null;
      if (!dex || got.has(dex) || !Rt.D.species[dex] || !inRegionDex(dex, region) || !itemOn(it.key)) continue;
      const areas = Rt.D.areaList.filter((a) => a.regionId === region && (a.lootPool ?? []).some((l) => l.itemKey === it.key && (l.weight ?? 1) > 0)).map((a) => a.id);
      out.push({ key: it.key, dex, price: it.price ?? Infinity, inShop: !!it.inShop && (it.shopBadges ?? 0) <= badges, areas });
    }
    return out;
  }

  /** Paliers d'une famille d'objets en vente (débloqués par les badges), du plus faible au plus fort. */
  function shopTiers(kind, field, save) {
    const badges = badgeCount(save);
    return Object.values(Rt.D.items)
      .filter((i) => i.effect?.kind === kind && i.inShop && itemOn(i.key) && (i.shopBadges ?? 0) <= badges && !(kind === 'ball' && i.effect.bonus >= 10))
      .sort((a, b) => (a.effect[field] ?? 0) - (b.effect[field] ?? 0) || a.price - b.price);
  }
  /** Stock "équivalent" d'un palier : cet objet ET les plus forts de la même famille. */
  const stockFrom = (tiers, idx, have) => tiers.slice(Math.max(0, idx)).reduce((n, i) => n + (have[i.key] ?? 0), 0);

  /** Palier de soin adapté à l'équipe : rend ≥ healTargetRatio des PV max du plus gros Pokémon (40 PV → Potion). */
  function healTierFor(save, tiers = shopTiers('heal', 'amount', save)) {
    const maxHp = Math.max(1, ...teamMons(save).map((m) => m.maxHp || 0));
    const need = maxHp * CONFIG.healTargetRatio;
    const idx = tiers.findIndex((t) => t.effect.amount >= need);
    return { idx: idx >= 0 ? idx : tiers.length - 1, need, maxHp };
  }

  /** Stock visé d'après la consommation mesurée (repli : CONFIG.stock tant qu'il n'y a pas assez de rencontres). */
  function targetFromRate(fam, fallback, lo, hi) {
    const r = Ledger.rate(fam);
    return clamp(r == null ? fallback : Math.ceil(r * CONFIG.stockHorizon + 1), lo, hi);
  }

  /* Capture : le jeu tire un dé 1–6, ajoute le bonus de la Ball, et capture si total ≥ difficulté (catchValue 1–9). */
  const CATCH_DIE = 6;
  const catchNeed = (dex) => { const v = Rt.D.species[dex]?.catchValue; return Number.isFinite(v) ? clamp(Math.round(v), 1, 9) : 5; };
  const catchPct = (need, bonus) => clamp((CATCH_DIE + 1 - (need - bonus)) / CATCH_DIE, 0, 1);
  /** Ball (parmi "Sans Ball" + paliers en vente) la moins chère qui atteint `pct` % ; sinon la plus forte. */
  function ballFor(need, pct, tiers) {
    const opts = [{ key: null, price: 0, bonus: 0 }, ...tiers.map((t) => ({ key: t.key, price: t.price, bonus: t.effect.bonus }))];
    return opts.filter((o) => catchPct(need, o.bonus) * 100 >= pct).sort((a, b) => a.price - b.price)[0] ?? opts.at(-1);
  }

  /**
   * Besoins en Balls des zones où l'on va jouer : pour chaque espèce absente du Pokédex,
   * la Ball qui suffit et le nombre de lancers espérés (1 / chance).
   * @returns {{tiers, want: Object<string,number>, species: {dex, need, key, pct}[]}}
   */
  function ballPlan(save) {
    const tiers = shopTiers('ball', 'bonus', save);
    const caught = obtainedDex(save);
    const areas = [...new Set([currentArea(save), desiredArea(save), CONFIG.mode === 'progression' ? nextAreaFor(save) : null].filter(Boolean))];
    const want = {}, species = [], seen = new Set();
    for (const a of areas) {
      for (const dex of wildDexes(a)) {
        if (caught.has(dex) || seen.has(dex)) continue;
        seen.add(dex);
        const need = catchNeed(dex);
        const b = ballFor(need, CONFIG.catchNewPct, tiers);
        const pct = catchPct(need, b.bonus);
        species.push({ dex, need, key: b.key, pct });
        if (b.key) want[b.key] = (want[b.key] ?? 0) + Math.ceil(1 / Math.max(pct, 0.2));
      }
    }
    return { tiers, want, species };
  }

  /**
   * Liste d'achats. Chaque ligne : { key, qty, family, urgent }.
   * - Soins : palier selon les PV de l'équipe, quantité selon la consommation mesurée (+ réserve boss).
   * - Balls : celles qu'exigent les espèces manquantes des zones visées (chance exacte), + Balls courantes
   *   selon la consommation, + petite réserve de la meilleure pour chromatiques / légendaires.
   */
  function shopWishlist(save) {
    const have = save?.inventory ?? {};
    const out = [];
    const area = currentArea(save);

    const heals = shopTiers('heal', 'amount', save);
    if (heals.length && CONFIG.buy.heal) {
      const { idx } = healTierFor(save, heals);
      // Les soins plus faibles comptent aussi, à leur valeur en PV (9 Potions de 20 PV ≈ 3 Super Potions de 50 PV)
      const lowerHp = heals.slice(0, idx).reduce((n, t) => n + (have[t.key] ?? 0) * (t.effect.amount ?? 0), 0);
      const owned = stockFrom(heals, idx, have) + Math.floor(lowerHp / Math.max(1, heals[idx].effect.amount ?? 1));
      const boss = bossPending(area, save);
      let target = targetFromRate('heal', CONFIG.stock.heal, CONFIG.healMinStock, CONFIG.healMaxStock);
      if (boss) target = Math.max(target, CONFIG.bossHealStock);
      if (owned < target) out.push({ key: heals[idx].key, qty: target - owned, family: 'heal', urgent: owned < (boss ? CONFIG.bossHealStock : CONFIG.healMinStock) });
    }

    const plan = ballPlan(save);
    const balls = plan.tiers;
    if (balls.length && (CONFIG.buy.ball || CONFIG.buy.rareBall)) {
      const need = Object.fromEntries(balls.map((b) => [b.key, plan.want[b.key] ?? 0]));
      const top = balls.at(-1);
      if (balls.length > 1 && CONFIG.buy.rareBall) need[top.key] += CONFIG.stock.rareBall;
      // Balls courantes (espèces déjà connues, remplacements) : la moins chère, selon la consommation
      if (CONFIG.catchKnown !== 'free') need[balls[0].key] += targetFromRate('ball', CONFIG.stock.ball, CONFIG.ballMinStock, CONFIG.ballMaxStock);
      else need[balls[0].key] += CONFIG.ballMinStock;
      // Du plus fort au plus faible : une Ball plus forte en trop couvre un besoin plus faible
      let surplus = 0;
      const anyOwned = balls.reduce((n, b) => n + (have[b.key] ?? 0), 0);
      const urgentKeys = new Set(plan.species.filter((s) => s.key && (area?.wildPool ?? []).some((w) => w.dex === s.dex)).map((s) => s.key));
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        const left = (have[b.key] ?? 0) + surplus - need[b.key];
        if (left >= 0) { surplus = left; continue; }
        surplus = 0;
        const family = i === balls.length - 1 && balls.length > 1 ? 'rareBall' : 'ball';
        if (!CONFIG.buy[family]) continue;
        const missingHere = urgentKeys.has(b.key) && stockFrom(balls, i, have) === 0;
        out.push({ key: b.key, qty: -left, family, urgent: (i === 0 && anyOwned < CONFIG.ballMinStock) || missingHere });
      }
    }

    if (CONFIG.buy.cure) for (const c of shopTiers('cure', 'x', save)) if ((have[c.key] ?? 0) < CONFIG.stock.cure) out.push({ key: c.key, qty: CONFIG.stock.cure - (have[c.key] ?? 0), family: 'cure' });
    // Objets d'évolution vers une espèce manquante (Pierres Feu/Eau/Foudre/Plante/Lune… en vente à partir de 4 badges)
    const buyStones = CONFIG.buyEvolutionItems === 'always' || (CONFIG.buyEvolutionItems === 'pokedex' && CONFIG.mode === 'pokedex' && CONFIG.dexFocus === 'evo');
    if (buyStones) {
      const badges = badgeCount(save);
      const wanted = new Map();
      for (const t of itemEvolutions(save)) {
        const it = Rt.D.items[t.item];
        if (t.owned > 0 || !it?.inShop || (it.shopBadges ?? 0) > badges) continue;
        wanted.set(t.item, (wanted.get(t.item) ?? 0) + 1);
      }
      for (const [key, qty] of wanted) out.push({ key, qty, family: 'stone' });
    }
    const ether = shopTiers('rerolls', 'amount', save)[0];
    if (CONFIG.buy.ether && ether && badgeCount(save) >= 3 && (have[ether.key] ?? 0) < CONFIG.stock.ether) out.push({ key: ether.key, qty: CONFIG.stock.ether - (have[ether.key] ?? 0), family: 'ether' });
    // Appât : lancé quand une Ball échoue de peu sur une nouvelle espèce, un chromatique ou un légendaire
    const bait = shopTiers('bait', 'x', save)[0];
    const baitHave = Object.entries(have).reduce((n, [k, q]) => n + (Rt.D.items[k]?.effect?.kind === 'bait' ? q : 0), 0);
    if (CONFIG.buy.bait && bait && baitHave < (CONFIG.stock.bait ?? 0)) out.push({ key: bait.key, qty: CONFIG.stock.bait - baitHave, family: 'bait' });
    // Fossiles en vente pour une espèce manquante (mode Pokédex : captures) : un seul exemplaire suffit
    if (CONFIG.buy.fossil && CONFIG.mode === 'pokedex' && CONFIG.dexFocus === 'catch') {
      for (const f of fossilTargets(save)) if (f.inShop && !(have[f.key] > 0)) out.push({ key: f.key, qty: 1, family: 'fossil' });
    }

    // Urgences d'abord, puis soins > Balls > meilleures Balls > appâts > objets d'évolution > fossiles > remèdes > Huile
    const order = { heal: 0, ball: 1, rareBall: 2, bait: 3, stone: 4, fossil: 5, cure: 6, ether: 7 };
    return out.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || order[a.family] - order[b.family]);
  }

  /** Objets à revendre (moitié prix) : surplus massifs, soins devenus trop faibles, objets d'évolution sans usage. */
  function sellList(save) {
    if (!CONFIG.buy.sell) return [];
    const have = save?.inventory ?? {};
    const out = [];
    const maxHp = Math.max(1, ...teamMons(save).map((m) => m.maxHp || 0));
    const reserved = new Set(itemEvolutions(save).map((t) => t.item));
    for (const [key, n] of Object.entries(have)) {
      const it = Rt.D.items[key];
      if (!n || !it?.price || it.unique) continue;
      const fam = familyOf(key);
      let keep = Infinity;
      if (['heal', 'ball', 'cure', 'ether'].includes(fam) && n > CONFIG.sellAbove) keep = Math.floor(CONFIG.sellAbove / 2);
      if (fam === 'heal' && CONFIG.sellObsoleteHeals && (it.effect?.amount ?? Infinity) < maxHp * 0.2) keep = Math.min(keep, 2);
      if (fam === 'stone' && CONFIG.sellDeadStones && !reserved.has(key) && !anyUseFor(key, save)) keep = 0;
      if (n > keep) out.push({ key, qty: n - keep, family: fam });
    }
    return out;
  }
  /** Un Pokémon possédé peut-il (aujourd'hui ou plus tard) utiliser cet objet d'évolution ? */
  function anyUseFor(item, save) {
    const region = regionId(save);
    return [...teamMons(save), ...boxMons(save)].some((m) => [m.dex, ...evoDescendants(m.dex, region).map((d) => d.toDex)].some((dex) => evosOf(dex, region).some((e) => e.item === item)));
  }

  /** Or à garder pour les consommables : les améliorations ne doivent pas vider la bourse avant les soins/Balls. */
  function consumablesReserve(save) {
    const cost = shopWishlist(save).reduce((n, w) => n + w.qty * priceOf(w.key), 0);
    return CONFIG.goldReserve + Math.min(cost, Math.floor((save?.gold ?? 0) * 0.6));
  }

  /**
   * Valeur d'une amélioration = gain de dégâts pondéré / coût.
   * Poids d'un type de dé : 1 par dé dans l'équipe, upgradeBoxWeight par dé des meilleurs Pokémon de la Boîte,
   * ×upgradeBossBoost s'il est super efficace contre le boss en attente.
   */
  function upgradeCandidates(save) {
    const team = teamMons(save).filter((m) => m.stats);
    if (!team.length) return [];
    const out = [];
    const weight = {};
    for (const m of team) for (const t of m.stats.dice) weight[t] = (weight[t] ?? 0) + 1;
    const teamIds = new Set(team.map((m) => m.id));
    const bench = boxMons(save).filter((m) => m.stats && !teamIds.has(m.id)).sort((a, b) => b.level - a.level).slice(0, 6);
    for (const m of bench) for (const t of m.stats.dice) weight[t] = (weight[t] ?? 0) + CONFIG.upgradeBoxWeight;
    const area = currentArea(save);
    const bossTypes = bossPending(area, save) ? bossTeam(area).flatMap((b) => Rt.E.speciesAt(b.dex, b.level)?.types ?? []) : [];
    if (CONFIG.buy.dieUpgrades) for (const [type, w] of Object.entries(weight)) {
      if (type === 'base' || !Rt.D.dice[type]?.upgradeable) continue;
      const lvl = save.dieLevels?.[type] ?? 1;
      const nextRow = Rt.D.dieUp[type]?.find((r) => r.level === lvl + 1);
      if (!nextRow) continue;
      const delta = nextRow.bonus - Rt.E.dieBonus(type, { dieLevels: { [type]: lvl } });
      const boost = bossTypes.some((d) => (Rt.D.chart[`${type}>${d}`] ?? 1) >= 2) ? CONFIG.upgradeBossBoost : 1;
      out.push({ kind: 'die', key: type, cost: nextRow.cost, value: (delta * w * boost) / nextRow.cost, label: Rt.t('ui.upgrades.dieName', 'Dé {type}').replace('{type}', Rt.t('ui.type.' + type, type)) });
    }
    if (CONFIG.buy.comboUpgrades) {
      // Fréquence de chaque combo pour les dés de l'équipe (Monte Carlo léger, graine fixe → décision stable)
      const freq = Object.fromEntries(COMBOS.map((c) => [c, 0]));
      let samples = 0, seed = 12345;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (const m of team) for (let s = 0; s < 400; s++) {
        const vals = m.stats.dice.map((t) => { const fs = Rt.E.facesOf(t); return Rt.E.faceVal(fs[(rnd() * fs.length) | 0]); });
        let best = null, bb = -1;
        for (const k of Rt.E.combosIn(vals)) { const b = Rt.E.comboBonus(k, save); if (b > bb) { bb = b; best = k; } }
        if (best) freq[best]++;
        samples++;
      }
      for (const k of COMBOS) {
        const lvl = save.comboLevels?.[k] ?? 1;
        const nextRow = Rt.D.comboUp[k]?.find((r) => r.level === lvl + 1);
        if (!nextRow || !freq[k]) continue;
        const delta = nextRow.bonus - Rt.E.comboBonus(k, save);
        out.push({ kind: 'combo', key: k, cost: nextRow.cost, value: (delta * freq[k] / samples * team.length) / nextRow.cost, label: Rt.t('ui.combo.' + k, k) });
      }
    }
    return out.sort((a, b) => b.value - a.value);
  }

  /** Budget disponible pour les améliorations (après réserve consommables). */
  const upgradeBudget = (save) => Math.floor(Math.max(0, (save?.gold ?? 0) - consumablesReserve(save)) * CONFIG.upgradeShare);

  /**
   * Amélioration à acheter maintenant, ou null.
   * Épargne ciblée : tant que la plus rentable n'est pas abordable, on n'achète une autre amélioration
   * que si elle est presque aussi rentable (upgradeSaveRatio) — fini les petits achats qui retardent les gros.
   */
  function upgradePick(save, cands = upgradeCandidates(save)) {
    if (!cands.length) return null;
    const budget = upgradeBudget(save);
    const best = cands[0];
    if (best.cost <= budget) return best;
    if (CONFIG.upgradeStrategy === 'greedy') return cands.find((u) => u.cost <= budget) ?? null;
    const alt = cands.find((u) => u.cost <= budget && u.value >= best.value * CONFIG.upgradeSaveRatio) ?? null;
    if (!alt && mem.saveLog !== best.key + best.cost) { mem.saveLog = best.key + best.cost; log(`🐷 épargne pour ${best.label} (₽${best.cost}) — budget actuel ₽${budget}`); }
    return alt;
  }

  /** "Chance de capture" (seconde chance quand la Ball rate) : autorisée, ou d'office en mode Pokédex (captures). */
  const wantLuck = () => CONFIG.buy.luck || (CONFIG.pokedexLuck && CONFIG.mode === 'pokedex' && CONFIG.dexFocus === 'catch');
  /** Améliorations "Général" : niveau courant lu dans la sauvegarde, sinon mémorisé lors de la dernière visite. */
  const GENERAL_KEY = 'pokebot.general';
  const generalLevels = () => { try { return JSON.parse(localStorage.getItem(GENERAL_KEY)) ?? {}; } catch { return {}; } };
  function generalWish(save) {
    const cfg = Rt.D.config.general;
    if (!cfg || (cfg.access && cfg.access !== 'all')) return [];
    const known = generalLevels();
    const out = [];
    const lvlOf = (k) => (typeof save?.general?.[k] === 'number' ? save.general[k] : save?.general?.[k]?.level ?? known[k] ?? 0);
    if (CONFIG.buy.offline) { const l = lvlOf('offline'); const row = cfg.offline?.[l]; if (row && l < CONFIG.offlineMaxLevel) out.push({ key: 'offline', name: Rt.t('ui.general.offline.name', 'Gains hors ligne'), cost: row.cost, level: l }); }
    if (wantLuck()) { const l = lvlOf('luck'); const row = cfg.luck?.[l]; if (row && l < CONFIG.luckMaxLevel) out.push({ key: 'luck', name: Rt.t('ui.general.luck.name', 'Chance de capture'), cost: row.cost, level: l }); }
    return out;
  }

  /**
   * Ce que la boutique achètera VRAIMENT avec l'or actuel (même calcul pour décider du trajet et pour acheter) :
   * - chaque famille a sa part de l'or ; une urgence peut entamer la réserve et prend au moins 1 exemplaire si on peut le payer ;
   * - une Ball trop chère est remplacée par la plus forte Ball abordable (une chance de capture vaut mieux que rien).
   * @returns {{items: {key, qty, family, urgent, instead?}[], skipped: object[], spent: number}}
   */
  function shopPlan(save) {
    const gold = save?.gold ?? 0;
    const spendable = Math.max(0, gold - CONFIG.goldReserve);
    const balls = shopTiers('ball', 'bonus', save);
    const items = [], skipped = [];
    let spent = 0;
    const take = (w, key, price) => {
      const pool = w.urgent ? gold : spendable; // l'urgence peut entamer la réserve
      const left = pool - spent;
      const share = CONFIG.shopShares[w.urgent ? 'urgent' : w.family] ?? 0.2;
      let qty = Math.min(w.qty, Math.floor((pool * share) / price), Math.floor(left / price));
      if (qty <= 0 && w.urgent && price <= left) qty = 1;
      return Math.max(0, qty);
    };
    for (const w of shopWishlist(save)) {
      const price = priceOf(w.key);
      let qty = take(w, w.key, price);
      if (qty > 0) { items.push({ ...w, qty }); spent += qty * price; continue; }
      // Ball trop chère : la plus forte Ball moins chère qu'on peut payer
      const i = balls.findIndex((b) => b.key === w.key);
      const alt = i > 0 ? balls.slice(0, i).reverse().find((b) => take(w, b.key, b.price) > 0) : null;
      if (alt) { qty = take(w, alt.key, alt.price); items.push({ ...w, key: alt.key, qty, instead: w.key }); spent += qty * alt.price; continue; }
      skipped.push(w);
    }
    return { items, skipped, spent };
  }

  async function chores(force = false) {
    const save = readSave();
    if (!save) return false;
    const gold = save.gold ?? 0;
    // On ne repart en courses que si l'or a bougé depuis la dernière fois (gain de combat) : plus de boucle
    if (!force && gold === mem.lastChoresGold) return false;
    mem.lastChoresGold = gold;
    const plan = shopPlan(save);
    const sells = sellList(save);
    const pick = upgradePick(save);
    const gen = generalWish(save).filter((g) => g.cost <= upgradeBudget(save));
    const urgent = plan.items.some((i) => i.urgent);
    const shopNeeded = urgent || plan.spent >= CONFIG.minBasket || sells.length > 0;
    const upgNeeded = !!pick || gen.length > 0;
    for (const w of plan.skipped.filter((x) => x.urgent)) {
      const sig = `${w.key}@${gold}`;
      if (mem.poorLog !== sig) { mem.poorLog = sig; log(`💸 ${Rt.t('item.' + w.key)} (₽${priceOf(w.key)}) : pas assez d'or (₽${gold}) — on attend les prochains gains`); }
    }
    if (!shopNeeded && !upgNeeded) return false;
    mem.choresStep = shopNeeded ? 'shop' : 'upgrades';
    log(`🛒 courses (₽${gold}) → ${mem.choresStep === 'shop' ? `boutique${urgent ? ' (urgent)' : ''} : ${plan.items.map((i) => `${Rt.t('item.' + i.key)} ×${i.qty}`).join(', ') || '—'}${sells.length ? ', revente ' + sells.length : ''}` : 'améliorations'}`);
    go(mem.choresStep === 'shop' ? '/shop' : '/upgrades');
    return true;
  }

  /** Onglet de la boutique : Acheter (#mart-buy) ou Vendre · Sac (#mart-sell). */
  async function martTab(which) {
    const tab = document.getElementById(`mart-${which}`) ?? btn(which === 'sell' ? 'ui.shop.sell' : 'ui.shop.buy');
    if (tab && tab.getAttribute('aria-selected') !== 'true') { tab.click(); await sleep(300); }
  }
  /** Attend que la sauvegarde reflète l'achat / la vente, puis l'inscrit au registre. */
  async function settle(prevGold, why) {
    await waitFor(() => (readSave()?.gold ?? prevGold) !== prevGold, 1200);
    Ledger.observe(readSave(), why);
  }

  async function playShop() {
    Ledger.observe(readSave());
    // 1) Revente
    const sells = sellList(readSave());
    if (sells.length) {
      await martTab('sell');
      for (const s of sells) {
        const card = $$(`button[aria-controls="sell-${s.key}"]`).find(visible)
          ?? $$('main button').find((x) => visible(x) && norm(x.innerText).startsWith(itemName(s.key) + ' '));
        if (!card) continue;
        if (card.getAttribute('aria-expanded') !== 'true') { card.click(); await sleep(300); }
        const panel = document.getElementById(`sell-${s.key}`) ?? card.parentElement;
        let qty = s.qty;
        for (const step of [5, 1]) {
          while (qty >= step) {
            const q = $$('button', panel).find((x) => norm(x.innerText) === `×${step}`);
            if (q) { q.click(); await sleep(120); }
            const sell = $$('button', panel).find((x) => enabled(x) && Rt.re('ui.shop.sellLabel').test(norm(x.getAttribute('aria-label'))));
            if (!sell) { qty = 0; break; }
            const g = readSave().gold;
            sell.click();
            await settle(g, { sell: true });
            qty -= step;
          }
        }
        log(`💱 revendu ${Rt.t('item.' + s.key)} ×${s.qty - qty} (${s.family === 'heal' && s.qty <= 40 ? 'soin trop faible' : 'surplus'})`);
      }
      await martTab('buy');
    }
    // 2) Achats : exactement le plan qui a décidé du trajet
    for (const w of shopPlan(readSave()).items) {
      const price = priceOf(w.key);
      let qty = w.qty;
      // aria-controls="buy-<clé>" n'existe qu'une fois la carte dépliée → on la trouve d'abord par son nom
      const card = $$(`button[aria-controls="buy-${w.key}"]`).find(visible)
        ?? $$('main button').find((x) => visible(x) && norm(x.innerText).startsWith(itemName(w.key) + ' ') && !x.getAttribute('aria-controls'));
      if (!card) continue;
      if (card.getAttribute('aria-expanded') !== 'true') { card.click(); await sleep(300); }
      const panel = document.getElementById(`buy-${w.key}`);
      if (!panel) continue;
      let bought = 0;
      for (const step of [10, 5, 1]) {
        while (qty >= step) {
          const q = $$('button', panel).find((x) => norm(x.innerText) === `×${step}`);
          if (q) { q.click(); await sleep(120); }
          const buy = $$('button', panel).find((x) => enabled(x) && Rt.re('ui.shop.buyFor').test(norm(x.innerText)));
          if (!buy) { qty = 0; break; }
          const g = readSave().gold;
          buy.click();
          await settle(g, { spend: w.family });
          if (readSave().gold === g) { qty = 0; break; } // achat refusé par le jeu : on n'insiste pas
          qty -= step; bought += step;
        }
      }
      if (bought) log(`🛍️ ${Rt.t('item.' + w.key)} ×${bought} (₽${bought * price}, ${FAMILY_LABEL[w.family]}${w.urgent ? ', urgent' : ''}${w.instead ? `, faute de ₽ pour ${Rt.t('item.' + w.instead)}` : ''})`);
    }
    mem.choresStep = 'upgrades';
    mem.lastChoresGold = readSave()?.gold ?? -1;
    go('/upgrades');
    return true;
  }

  /** Bouton de prix (₽…) d'une amélioration dont le bloc commence par `label`. */
  function priceButtonFor(label) {
    const priceBtns = $$('main button').filter((x) => visible(x) && enabled(x) && /^₽\s?[\d\s  ]+/.test(x.innerText.trim()));
    return priceBtns.find((x) => {
      let p = x.parentElement;
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) if (norm(p.innerText).startsWith(norm(label))) return true;
      return false;
    });
  }

  async function playUpgrades() {
    Ledger.observe(readSave());
    // Onglet Général : gains hors ligne (et chance de capture si autorisée)
    const gens = generalWish(readSave());
    if (gens.length) {
      const tab = btn('ui.upgrades.tabGeneral');
      if (tab) { tab.click(); await sleep(350); }
      const known = generalLevels();
      for (const g of gens) {
        // niveau réel affiché ("N.1") → mémorisé pour les prochaines décisions
        const block = $$('main *').find((x) => x.children.length > 2 && norm(x.innerText).startsWith(norm(g.name)));
        const lvl = +(norm(block?.innerText ?? '').match(/N\.\s*(\d+)/)?.[1] ?? NaN);
        if (Number.isFinite(lvl)) known[g.key] = lvl;
        const s = readSave();
        const row = Rt.D.config.general?.[g.key]?.[known[g.key] ?? g.level];
        if (!row || (known[g.key] ?? g.level) >= (g.key === 'offline' ? CONFIG.offlineMaxLevel : CONFIG.luckMaxLevel) || row.cost > upgradeBudget(s)) continue;
        const target = priceButtonFor(g.name);
        if (!target) continue;
        target.click();
        await settle(s.gold, { spend: 'general' });
        if (readSave().gold !== s.gold) { known[g.key] = (known[g.key] ?? g.level) + 1; log(`⬆️ ${g.name} N.${known[g.key]} (₽${row.cost})`); }
      }
      try { localStorage.setItem(GENERAL_KEY, JSON.stringify(known)); } catch {}
    }
    for (let guard = 0; guard < 12; guard++) {
      const save = readSave();
      const u = upgradePick(save);
      if (!u) break;
      const tab = btn(u.kind === 'combo' ? 'ui.upgrades.tabCombos' : 'ui.upgrades.tabDice');
      if (tab) { tab.click(); await sleep(350); }
      const target = priceButtonFor(u.label);
      if (!target) { log(`⚠️ amélioration introuvable à l'écran : ${u.label}`); break; }
      target.click();
      await settle(save.gold, { spend: 'upgrade' });
      if (readSave().gold === save.gold) break;
      log(`⬆️ ${u.label} (₽${u.cost})`);
    }
    mem.choresStep = null;
    mem.lastChoresGold = readSave()?.gold ?? -1;
    go('/home');
    return true;
  }

  /* ── 6.13 Confort : notifications, statistiques de session, planning ── */
  /**
   * Notification du navigateur (+ petit son). La permission est demandée quand on démarre le bot
   * (un clic de l'utilisateur est nécessaire) ; sans permission, seul le son et le journal restent.
   */
  function notify(title, body = '') {
    if (!CONFIG.notify) return;
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`PokéBot · ${title}`, { body, tag: 'pokebot-' + title, silent: true }); } catch {}
    if (CONFIG.notifySound) beep();
  }
  function beep() {
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (mem.audio ??= new Ctx());
      const t0 = ctx.currentTime;
      for (const [i, f] of [660, 880].entries()) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; g.gain.setValueAtTime(0.08, t0 + i * 0.15); g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.15 + 0.14);
        o.connect(g).connect(ctx.destination); o.start(t0 + i * 0.15); o.stop(t0 + i * 0.15 + 0.15);
      }
    } catch {}
  }
  /**
   * Anti-veille : Screen Wake Lock du navigateur. Tant que le bot tourne et que l'onglet est visible,
   * l'écran ne s'éteint pas et le PC ne se met pas en veille. Le navigateur libère le verrou quand l'onglet
   * est caché ou réduit : on le redemande au retour. Il ne protège pas d'une fermeture du capot ni d'une
   * mise en veille forcée par Windows (batterie faible, stratégie de l'entreprise).
   */
  const WakeLock = {
    lock: null,
    async on() {
      if (!CONFIG.keepAwake || this.lock || document.hidden) return;
      try {
        if (!navigator.wakeLock?.request) { if (!mem.wakeWarned) { mem.wakeWarned = true; log('☕ anti-veille indisponible dans ce navigateur'); } return; }
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener?.('release', () => { this.lock = null; });
        if (!mem.wakeLogged) { mem.wakeLogged = true; log('☕ anti-veille actif : l’écran et le PC restent éveillés tant que le bot tourne'); }
      } catch (e) { this.lock = null; if (!mem.wakeWarned) { mem.wakeWarned = true; log(`☕ anti-veille refusé par le navigateur (${e.message})`); } }
    },
    async off() { const l = this.lock; this.lock = null; try { await l?.release(); } catch {} },
  };
  const askNotifyPermission = () => { try { if (CONFIG.notify && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } catch {} };

  /**
   * Statistiques de session (pokebot.stats) : captures, chromatiques, lancers de Ball par Ball, raids, Œufs, roue.
   * Mémorisées dans le navigateur, remises à zéro depuis l'onglet Bilan.
   */
  const STATS_KEY = 'pokebot.stats';
  const Stats = {
    d: null,
    data() { if (!this.d) { try { this.d = JSON.parse(localStorage.getItem(STATS_KEY)); } catch {} this.d ??= this.blank(); } return this.d; },
    blank: () => ({ since: Date.now(), caught: 0, newSpecies: 0, shinySeen: 0, shinyCaught: 0, throws: {}, raidsWon: 0, raidsLost: 0, eggs: 0, shinyEggs: 0, spins: 0, rebattleWins: 0 }),
    add(k, n = 1) { const d = this.data(); d[k] = (d[k] ?? 0) + n; this.save(); },
    /** Un lancer de Ball : par nom affiché, réussi ou non. */
    throw(ball, ok) { const d = this.data(); const t = (d.throws[ball] ??= { n: 0, ok: 0 }); t.n++; if (ok) t.ok++; this.save(); },
    save() { try { localStorage.setItem(STATS_KEY, JSON.stringify(this.d)); } catch {} },
    reset() { this.d = this.blank(); this.save(); },
  };
  /** Issue du dernier lancer : le texte de résultat (capturé / raté / il reste) apparaît après le lancer. */
  function noteCatchResult() {
    const p = mem.throwPending;
    if (!p) return;
    const caught = lineHas('ui.catch.caught'), missed = bodyHas('ui.catch.missed') || lineHas('ui.catch.stayed');
    if (!caught && !missed) { if (Date.now() - p.at > 15000) mem.throwPending = null; return; }
    mem.throwPending = null;
    Stats.throw(p.ball, caught);
    if (!caught) return;
    Stats.add('caught');
    if (p.isNew) Stats.add('newSpecies');
    if (p.shiny) { Stats.add('shinyCaught'); notify('Chromatique capturé !', p.name); }
    else if (p.legendary) notify('Légendaire capturé !', p.name);
  }

  /**
   * Planning : "08:00-23:00=pokedex; 23:00-08:00=farm". Plages à l'heure locale, la fin peut passer minuit.
   * @returns {{from:number, to:number, mode:string}[]} minutes depuis minuit
   */
  function parseSchedule(txt) {
    const out = [];
    for (const part of String(txt ?? '').split(/[;\n]+/)) {
      const m = part.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*=\s*([\w]+)$/);
      if (!m || !MODES[m[5]]) continue;
      out.push({ from: (+m[1] % 24) * 60 + (+m[2] || 0), to: (+m[3] % 24) * 60 + (+m[4] || 0), mode: m[5] });
    }
    return out;
  }
  /** Mode prévu par le planning à cette heure (null si aucune plage ne couvre l'instant). */
  function scheduledMode(txt = CONFIG.schedule, date = new Date()) {
    const t = date.getHours() * 60 + date.getMinutes();
    const r = parseSchedule(txt).find((x) => (x.from <= x.to ? t >= x.from && t < x.to : t >= x.from || t < x.to));
    return r?.mode ?? null;
  }
  /** Applique le planning entre deux rencontres (le mode choisi à la main reste tant qu'aucune plage ne s'applique). */
  function applySchedule() {
    const want = scheduledMode();
    const cur = CONFIG.activity ?? CONFIG.modeKey ?? CONFIG.mode;
    if (!want || want === cur) return false;
    log(`⏰ planning : passage en mode ${MODES[want].label}`);
    setMode(want, { farmAreaId: want === 'farm' ? CONFIG.farmAreaId ?? readSave()?.currentAreaId : undefined });
    return true;
  }

  /* ═════════════════════════════ 7. BOT ═════════════════════════════ */
  const bot = {
    running: false, busy: false, lastActionAt: 0, idleTicks: 0, stats: { actions: 0 }, timer: null, ready: false, awaitingChange: false, observer: null,

    async tick() {
      if (!this.running || this.busy || !this.ready) return;
      const since = Date.now() - this.lastActionAt;
      if (since < CONFIG.minActionGapMs) return;
      // Après une action, on attend que l'écran réagisse (ou au plus actionCooldownMs) avant d'agir de nouveau
      if (this.awaitingChange && since < CONFIG.actionCooldownMs) return;
      // Pages hors mode solo (classement, Versus, raids, échanges…) : on en ressort immédiatement
      const actPage = ((CONFIG.activity === 'versus' || mem.vsDefense) && location.pathname.startsWith('/versus')) || (CONFIG.activity === 'raid' && /^\/(raid|events)\//.test(location.pathname))
        || (mem.errand && location.pathname === ERRAND_PATH[mem.errand]);
      if (!actPage && /versus|raid|leaderboard|trade|friends|daycare|events/i.test(location.pathname)) {
        const back = btn(['ui.common.backHome', 'ui.common.back']);
        if (back) back.click(); else if (!go('/home')) history.back();
        this.lastActionAt = Date.now();
        return;
      }
      this.busy = true;
      let acted = false, where = '';
      try {
        const path = location.pathname;
        Ledger.observe(readSave());
        Ledger.report();
        noteCatchResult();
        const tuto = btn('ui.oak.gotIt');
        if (tuto) { tuto.click(); acted = true; where = 'tuto'; }

        // Annonce du Prof. Chen sur le classement : son seul bouton ouvre la page Classement.
        // On le valide (sinon la fenêtre reste), puis la garde ci-dessus ramène aussitôt à l'accueil.
        if (!acted) {
          const d = dialog();
          const only = d && $$('button', d).filter((x) => visible(x) && enabled(x));
          if (only?.length === 1 && norm(only[0].innerText).includes(norm(Rt.t('ui.nav.leaderboard', 'Classement')))) {
            log('🏆 annonce du classement fermée (le bot n\'y joue pas)'); only[0].click(); acted = true;
          }
        }

        if (!acted && mem.errand === 'rebattle' && playRebattleEnd()) { acted = true; where = 'rebattle'; }
        if (!acted && bodyHas('ui.wipe.title')) { const r = btn('ui.wipe.tryAgain'); if (r) { settleBossFight(true); log('💀 équipe K.O. → réessayer'); r.click(); acted = true; } }

        if (!acted && path.startsWith('/versus') && (CONFIG.activity === 'versus' || mem.vsDefense)) { where = 'versus'; acted = await playVersus(); if (!acted) acted = true; }

        if (!acted) { const rep = pickReplacement(); if (rep) { log(`🔁 envoie ${rep.name} (duel ${rep.s.toFixed(2)})`); rep.el.click(); acted = true; } }

        if (!acted) { const b = readBattle(); if (b) { if (mem.bossFight) mem.bossFight.seen = true; where = 'battle'; acted = await playBattle(b); } }

        if (!acted && (bodyHas('ui.catch.tip') || btn(['ui.catch.roll', 'ui.catch.catch']))) { where = 'catch'; acted = await playCatch(); }

        if (!acted && mem.errand && path === ERRAND_PATH[mem.errand]) { where = mem.errand; acted = await playErrand(); }
        if (!acted && !mem.errand && CONFIG.activity === 'raid' && /^\/(raid|events)\//.test(path)) { where = 'raid'; acted = await playRaidPage(); if (!acted && !readBattle()) acted = false; }
        if (!acted && path === '/shop' && mem.choresStep === 'shop') { where = 'shop'; acted = await playShop(); }
        if (!acted && path === '/upgrades' && mem.choresStep === 'upgrades') { where = 'upgrades'; acted = await playUpgrades(); }
        if (!acted && path === '/team' && mem.evolve) { where = 'evolve'; acted = await playItemEvolution(); }
        if (!acted && (path === '/shop' || path === '/upgrades' || path === '/team' || path === '/pokedex')) { acted = go('/home'); }

        if (!acted && bodyHas('ui.center.restHere')) { where = 'center'; acted = await playCenter(); }

        if (!acted) { const leave = btn('ui.casino.leave'); if (leave && bodyHas('ui.casino.machine')) { log('↷ Casino : on part'); leave.click(); acted = true; } }
        if (!acted) { const k = encounterKind(); if (k) { where = 'enc:' + k; acted = await playEncounter(k); } }

        if (!acted) { where = 'victory'; acted = await playVictory(); }
        if (!acted) { where = 'area'; acted = await playArea(); }

        if (acted) { this.lastActionAt = Date.now(); this.awaitingChange = true; this.idleTicks = 0; this.stats.actions++; }
        // Pendant un combat, l'adversaire joue (animations parfois longues, surtout onglet en arrière-plan) : on patiente 4× plus
        else if (++this.idleTicks >= CONFIG.stopAfterIdleTicks * (readBattle() ? 4 : 1)) {
          // Écran inconnu : on tente de fermer une fenêtre, sinon on s'arrête en décrivant l'écran
          if (closeDialog()) { this.idleTicks = 0; }
          else {
            const snap = $$('button').filter(visible).map((x) => norm(x.innerText) || x.getAttribute('aria-label')).filter(Boolean).slice(0, 15).join(' / ');
            log(`❓ écran non reconnu (${location.pathname}) : ${snap}`);
            this.stop('écran non reconnu');
            notify('Bot arrêté', `écran non reconnu (${location.pathname})`);
          }
        }
      } catch (e) {
        console.error('[PokéBot]', e); log(`💥 ${where}: ${e.message}`);
      } finally { this.busy = false; ui.refresh(); }
    },

    async start() {
      if (!this.ready) { await Rt.load(); this.ready = true; loadSettings(); ui.fillAreas(); }
      this.running = true; this.idleTicks = 0;
      askNotifyPermission();
      WakeLock.on();
      this.timer ??= setInterval(() => this.tick(), CONFIG.tickMs);
      this.watchScreen();
      applyShortAnimations();
      writeSettings({ running: true });
      log('▶ démarré'); ui.refresh();
    },
    /**
     * Réagit aux changements d'écran : dès que le jeu modifie le DOM (bouton activé, modale ouverte…),
     * on relance un tick ~40 ms plus tard au lieu d'attendre le prochain intervalle.
     * Les mutations de style (animations à 60 i/s) sont ignorées : seuls comptent les changements d'état.
     */
    watchScreen() {
      if (this.observer) return;
      let pending = null;
      this.observer = new MutationObserver((muts) => {
        if (muts.every((m) => ui.host?.contains(m.target))) return;
        this.awaitingChange = false;
        if (!pending) pending = setTimeout(() => { pending = null; this.tick(); }, 40);
      });
      this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-pressed', 'aria-expanded', 'aria-label'] });
      document.addEventListener('visibilitychange', () => {
        if (this.running && !document.hidden) WakeLock.on(); // le verrou saute quand l'onglet est caché
        if (this.running && document.hidden) log('⚠️ onglet en arrière-plan : Chrome ralentit fortement le jeu (tour ×3 mesuré). Garde la fenêtre visible.');
      });
    },
    stop(reason = 'manuel') { this.running = false; WakeLock.off(); if (reason === 'manuel') writeSettings({ running: false }); log('⏸ arrêté : ' + reason); ui.refresh(reason); },
    toggle() { this.running ? this.stop() : this.start(); },
  };

  /* ═════════════════════════════ 8. MODES & RÉGLAGES ═════════════════════════════ */
  const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => (x[k] ??= {}), o); t[last] = v; };
  const readSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; } };
  const writeSettings = (patch) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), ...patch })); } catch {} };
  /** Réglages choisis dans le panneau (prioritaires sur les valeurs du mode). */
  const applyUserConfig = () => { for (const [p, v] of Object.entries(readSettings().cfg ?? {})) setPath(CONFIG, p, v); };

  /**
   * Change de mode (et mémorise le choix).
   * @param {'progression'|'pokedex'|'farm'} mode
   * @param {{farmAreaId?: string}} [opts]  zone de farm (défaut : zone courante)
   */
  function setMode(mode, { farmAreaId, persist = true } = {}) {
    if (!MODES[mode]) { console.warn('[PokéBot] mode inconnu :', mode, '— modes :', Object.keys(MODES).join(', ')); return false; }
    applyUserConfig();
    // Mode "activité" (Versus / Raids) : se joue par-dessus un mode de repli classique
    const act = MODES[mode].activity ? mode : null;
    const pick = act ? (MODES[CONFIG.activityFallback] && !MODES[CONFIG.activityFallback].activity ? CONFIG.activityFallback : 'progression') : mode;
    const { label: baseLabel, activity: _a, baseMode, ...overrides } = MODES[pick];
    const base = baseMode ?? pick; // "Pokédex : évolutions" = mode pokedex avec dexFocus 'evo'
    const label = act ? `${MODES[act].label} (repli : ${baseLabel})` : baseLabel;
    Object.assign(CONFIG, { dexFocus: 'catch' }, JSON.parse(JSON.stringify(overrides)), { mode: base, modeKey: pick, activity: act });
    applyUserConfig();
    mem.actLog = null;
    const saved = readSettings();
    if (typeof saved.lock?.[base] === 'boolean') CONFIG.lockTeam = saved.lock[base]; // choix 🔒 de l'utilisateur pour ce mode
    if (base === 'farm') CONFIG.farmAreaId = farmAreaId ?? CONFIG.farmAreaId ?? readSave()?.currentAreaId ?? null;
    mem.travelFail.clear();
    mem.lastChoresGold = -1; // re-vérifie les stocks avec les nouveaux objectifs
    mem.centerDone = null;
    mem.goldArea = null;
    if (persist) writeSettings({ mode, farmAreaId: CONFIG.farmAreaId });
    if (Rt.E) {
      const a = Rt.D.areas[CONFIG.farmAreaId];
      log(`🎛️ mode ${label}${base === 'farm' ? ' · zone : ' + (CONFIG.farmGoal === 'gold' ? 'la plus rentable en ₽' : Rt.areaLabel(a)) : ''}${base === 'pokedex' ? ' · ' + (readSave()?.pokedex?.length ?? 0) + ' espèces au Pokédex' : ''}`);
    }
    ui.refresh();
    return true;
  }
  /** Change un réglage (chemin "buy.heal", "stock.rareBall"…) et le mémorise. */
  function setOption(path, value, { persist = true } = {}) {
    setPath(CONFIG, path, value);
    if (path === 'keepAwake' && typeof WakeLock !== 'undefined') { if (value && bot.running) WakeLock.on(); else WakeLock.off(); }
    if (persist) writeSettings({ cfg: { ...readSettings().cfg, [path]: value } });
    mem.lastChoresGold = -1; mem.centerDone = null; mem.goldArea = null; mem.xpArea = null; mem.saveLog = null;
    if (path === 'activityFallback' && CONFIG.activity) setMode(CONFIG.activity);
    ui.refresh();
  }
  /** Revient aux réglages d'usine (le mode et la zone de farm sont conservés). */
  function resetOptions() {
    const keep = { mode: CONFIG.mode, farmAreaId: CONFIG.farmAreaId };
    for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(DEFAULTS)))) CONFIG[k] = v;
    writeSettings({ cfg: {}, lock: {} });
    setMode(keep.mode, { farmAreaId: keep.farmAreaId });
    log('♻️ réglages remis par défaut');
  }
  /** 🔒 Verrouille / déverrouille l'équipe pour le mode courant (mémorisé par mode). */
  function setTeamLock(on) {
    CONFIG.lockTeam = !!on;
    mem.centerDone = null;
    writeSettings({ lock: { ...readSettings().lock, [CONFIG.mode]: CONFIG.lockTeam } });
    log(CONFIG.lockTeam ? '🔒 équipe verrouillée : le bot ne touchera plus à la composition au Centre' : '🔓 équipe gérée par le bot');
    ui.refresh();
  }
  function loadSettings() {
    try { const s = readSettings(); setMode(s.mode ?? CONFIG.mode, { farmAreaId: s.farmAreaId, persist: false }); } catch { setMode(CONFIG.mode, { persist: false }); }
  }

  /**
   * Description du panneau ⚙️ : chaque champ = chemin dans CONFIG.
   * t: 'bool' | 'num' | 'pct' (affiché en %) | 'sel' ; o: options [valeur, libellé] ; h: aide (infobulle)
   */
  const PANEL = [
    { tab: 'Dépenses', icon: '💰', groups: [
      { title: 'Ce que le bot a le droit d’acheter', fields: [
        { p: 'buy.heal', t: 'bool', l: 'Soins (Potions…)' },
        { p: 'buy.ball', t: 'bool', l: 'Balls (captures)' },
        { p: 'buy.rareBall', t: 'bool', l: 'Meilleure Ball (réserve chromatiques / légendaires)' },
        { p: 'buy.cure', t: 'bool', l: 'Remèdes de statut' },
        { p: 'buy.ether', t: 'bool', l: 'Huiles (relances)' },
        { p: 'buyEvolutionItems', t: 'sel', l: 'Objets d’évolution', o: [['never', 'jamais'], ['pokedex', 'en mode Pokédex : évolutions'], ['always', 'toujours']] },
        { p: 'buy.dieUpgrades', t: 'bool', l: 'Améliorations des dés' },
        { p: 'buy.comboUpgrades', t: 'bool', l: 'Améliorations des combos' },
        { p: 'buy.offline', t: 'bool', l: 'Gains hors ligne (Général)' },
        { p: 'offlineMaxLevel', t: 'num', l: '↳ jusqu’au niveau', min: 0, max: 10 },
        { p: 'buy.luck', t: 'bool', l: 'Chance de capture (Général, cher)' },
        { p: 'pokedexLuck', t: 'bool', l: '↳ toujours en mode Pokédex : captures', h: 'Seconde chance quand la Ball rate : le Pokémon peut rester pour un autre lancer.' },
        { p: 'luckMaxLevel', t: 'num', l: '↳ jusqu’au niveau', min: 0, max: 10 },
        { p: 'buy.bait', t: 'bool', l: 'Appâts (lancés quand une Ball rate de peu)' },
        { p: 'buy.fossil', t: 'bool', l: 'Fossiles d’espèces manquantes (mode Pokédex)' },
        { p: 'buy.sell', t: 'bool', l: 'Revendre les surplus (½ prix)' },
      ] },
      { title: 'Budget', fields: [
        { p: 'goldReserve', t: 'num', l: 'Réserve jamais dépensée (₽)', min: 0, step: 10 },
        { p: 'minBasket', t: 'num', l: 'Panier minimum pour aller en boutique (₽)', min: 0, step: 10, h: 'Évite les allers-retours pour une seule Potion (sauf urgence).' },
        { p: 'upgradeStrategy', t: 'sel', l: 'Améliorations', o: [['save', 'épargne pour la plus rentable'], ['greedy', 'la meilleure abordable tout de suite']] },
        { p: 'upgradeSaveRatio', t: 'pct', l: '↳ en épargne, accepte une autre si rentable à', h: 'Pourcentage de la rentabilité de la meilleure amélioration.' },
        { p: 'upgradeShare', t: 'pct', l: 'Part de l’or libre pour les améliorations' },
        { p: 'upgradeBoxWeight', t: 'pct', l: 'Poids des dés de la Boîte (vs équipe)' },
      ] },
      { title: 'Part max de l’or par achat', fields: [
        { p: 'shopShares.heal', t: 'pct', l: 'Soins' }, { p: 'shopShares.ball', t: 'pct', l: 'Balls' }, { p: 'shopShares.rareBall', t: 'pct', l: 'Meilleure Ball' },
        { p: 'shopShares.stone', t: 'pct', l: 'Objets d’évolution' }, { p: 'shopShares.cure', t: 'pct', l: 'Remèdes' }, { p: 'shopShares.ether', t: 'pct', l: 'Huiles' },
        { p: 'shopShares.bait', t: 'pct', l: 'Appâts' }, { p: 'shopShares.fossil', t: 'pct', l: 'Fossiles' },
        { p: 'shopShares.urgent', t: 'pct', l: 'Urgence (stock à zéro)' },
      ] },
    ] },
    { tab: 'Stocks', icon: '🎒', groups: [
      { title: 'Stocks selon la consommation mesurée', fields: [
        { p: 'stockHorizon', t: 'num', l: 'Prévoir pour N rencontres', min: 5, max: 200, step: 5 },
        { p: 'rateWindow', t: 'num', l: 'Consommation mesurée sur N rencontres', min: 20, max: 300, step: 10 },
        { p: 'healMinStock', t: 'num', l: 'Soins : minimum', min: 0 }, { p: 'healMaxStock', t: 'num', l: 'Soins : maximum', min: 0 },
        { p: 'bossHealStock', t: 'num', l: 'Soins gardés avant un boss', min: 0 },
        { p: 'ballMinStock', t: 'num', l: 'Balls : minimum', min: 0 }, { p: 'ballMaxStock', t: 'num', l: 'Balls courantes : maximum', min: 0 },
        { p: 'stock.rareBall', t: 'num', l: 'Réserve de meilleures Balls', min: 0 },
        { p: 'stock.cure', t: 'num', l: 'Remèdes (par type)', min: 0 }, { p: 'stock.ether', t: 'num', l: 'Huiles', min: 0 },
        { p: 'stock.bait', t: 'num', l: 'Appâts', min: 0 },
        { p: 'stock.heal', t: 'num', l: 'Soins avant mesure (repli)', min: 0 }, { p: 'stock.ball', t: 'num', l: 'Balls avant mesure (repli)', min: 0 },
        { p: 'healTargetRatio', t: 'pct', l: 'Palier de soin : rend ≥ % des PV max', h: '40 PV × 50 % = 20 → Potion suffit.' },
      ] },
      { title: 'Revente', fields: [
        { p: 'sellAbove', t: 'num', l: 'Revendre au-delà de N exemplaires', min: 5, step: 5 },
        { p: 'sellObsoleteHeals', t: 'bool', l: 'Revendre les soins trop faibles (on en garde 2)' },
        { p: 'sellDeadStones', t: 'bool', l: 'Revendre les objets d’évolution inutiles' },
      ] },
    ] },
    { tab: 'Combat', icon: '⚔️', groups: [
      { title: 'Soins en combat', fields: [
        { p: 'healPolicy', t: 'sel', l: 'Politique', o: [['eco', 'économe (le Centre soigne gratis)'], ['normal', 'normale'], ['safe', 'prudente (ancien)']] },
        { p: 'potionBelowHpRatio', t: 'pct', l: '"PV bas" sous' },
        { p: 'ecoBackupRatio', t: 'pct', l: 'Économe : soigne si l’équipe de secours < ' },
        { p: 'dangerMargin', t: 'num', l: 'Marge de danger (× menace)', min: 1, max: 3, step: 0.05 },
        { p: 'cureBurnPoisonBelow', t: 'pct', l: 'Remède brûlure / poison sous' },
      ] },
      { title: 'Tactique', fields: [
        { p: 'manageLead', t: 'bool', l: 'Choisir le meneur avant chaque combat' },
        { p: 'leadSwitchGain', t: 'num', l: 'Change de meneur si meilleur de ×', min: 1, max: 3, step: 0.05 },
        { p: 'switchOnNewFoe', t: 'bool', l: 'Dresseur / arène : change de Pokémon si le suivant adverse le contre' },
        { p: 'switchBelow', t: 'num', l: '↳ si notre duel est sous', min: 0.3, max: 2, step: 0.05 },
        { p: 'switchGain', t: 'num', l: '↳ et qu’un autre fait mieux de ×', min: 1, max: 3, step: 0.05 },
        { p: 'fleeIfBestScoreBelow', t: 'num', l: 'Fuit un sauvage si duel <', min: 0, max: 2, step: 0.05 },
        { p: 'avoidTrainerIfBelow', t: 'num', l: 'Évite un dresseur si duel <', min: 0, max: 2, step: 0.05 },
        { p: 'rerollMinGain', t: 'num', l: 'Relance si gain ≥ (dégâts)', min: 0, max: 20, step: 0.5 },
        { p: 'rerollMinGainRatio', t: 'pct', l: 'Relance si gain ≥ (relatif)' },
      ] },
    ] },
    { tab: 'Captures', icon: '🎯', groups: [
      { title: 'Choix de la Ball (chance exacte : dé 1–6 + bonus ≥ difficulté)', fields: [
        { p: 'catchTarget', t: 'text', l: 'Espèce visée (nom affiché en jeu, vide = aucune)', h: 'Le bot va dans la zone ouverte où elle apparaît le plus et la capture avec la meilleure Ball. L’objectif s’efface une fois l’espèce au Pokédex.' },
        { p: 'catchNewPct', t: 'num', l: 'Nouvelle espèce : viser au moins (%)', min: 30, max: 100, step: 5 },
        { p: 'catchKnown', t: 'sel', l: 'Espèce déjà capturée', o: [['free', 'Sans Ball (gratuit)'], ['cheap', 'Ball la moins chère'], ['normal', 'la moins chère qui atteint le % ci-dessous']] },
        { p: 'catchMinPct', t: 'num', l: '↳ % visé', min: 0, max: 100, step: 5 },
        { p: 'pokedexFleeKnownMargin', t: 'num', l: 'Pokédex : fuit les espèces connues si l’équipe dépasse la zone de +N niv.', min: 0, max: 30 },
        { p: 'pokedexStallEncounters', t: 'num', l: 'Pokédex : quitte une zone après N rencontres sans nouvelle espèce', min: 10, max: 500, step: 10 },
        { p: 'pokedexStallMinutes', t: 'num', l: '↳ et n’y revient pas avant N minutes', min: 0, max: 600, step: 5 },
      ] },
    ] },
    { tab: 'Équipe & zones', icon: '🗺️', groups: [
      { title: 'Équipe', fields: [
        { p: 'manageTeam', t: 'bool', l: 'Composer l’équipe au Centre' },
        { p: 'xpTrainees', t: 'bool', l: 'XP : un porteur + des élèves de la Boîte', h: 'Multi Exp : un Pokémon au moins 14 niveaux sous le combattant reçoit 100 % de l’XP sans combattre. Plus d’XP perdue sur des Pokémon au niveau max.' },
        { p: 'carrierSafeScore', t: 'num', l: '↳ 2 porteurs si le duel du porteur est sous', min: 1, max: 4, step: 0.05 },
        { p: 'xpLead', t: 'bool', l: 'Meneur choisi pour l’XP utile (si sans risque)' },
        { p: 'trainWeakest', t: 'bool', l: 'Ancien : le moins haut niveau mène quand c’est sans risque' },
        { p: 'trainMinScore', t: 'num', l: '↳ duel minimal d’un meneur « pour l’XP »', min: 1, max: 3, step: 0.05 },
        { p: 'useEvolutionItems', t: 'bool', l: 'Utiliser les objets d’évolution du Sac' },
      ] },
      { title: 'Zones & boss', fields: [
        { p: 'autoTravel', t: 'bool', l: 'Changer de zone automatiquement' },
        { p: 'farmGoal', t: 'sel', l: 'Mode Farm : objectif', o: [['xp', 'XP / chromatiques (zone choisie)'], ['xpAuto', 'XP (zone la plus rentable sans risque)'], ['gold', '₽ (zone la plus rentable)']] },
        { p: 'nextAreaLevelSlack', t: 'num', l: 'Zone suivante si niveau ≥ min − N', min: 0, max: 20 },
        { p: 'bossReadyScore', t: 'num', l: 'Boss : duel moyen exigé', min: 0.5, max: 3, step: 0.05 },
        { p: 'bossWorstScore', t: 'num', l: 'Boss : pire duel accepté', min: 0, max: 2, step: 0.05 },
        { p: 'bossFailMargin', t: 'pct', l: 'Exigence en plus par défaite' },
      ] },
    ] },
    { tab: 'Versus & Raids', icon: '🐉', groups: [
      { title: 'Modes Versus et Raids', fields: [
        { p: 'activityFallback', t: 'sel', l: 'En attendant (verrouillé / rien à faire)', o: [['progression', 'Progression'], ['pokedex', 'Pokédex : captures'], ['pokedexEvo', 'Pokédex : évolutions'], ['farm', 'Farm']] },
      ] },
      { title: 'Versus (3 Pokémon au N.50, compte connecté)', fields: [
        { p: 'versusAutoTeam', t: 'bool', l: 'Équipe taillée contre chaque adversaire (puis équipe de défense)' },
        { p: 'versusMinMargin', t: 'num', l: 'N’affronte pas si marge simulée <', min: -1, max: 1, step: 0.05, h: '-1 = affronte tout le monde ; 0 = seulement les combats prévus gagnants' },
        { p: 'versusRecheckMin', t: 'num', l: 'Rien à battre : revenir dans N min', min: 5, max: 600, step: 5 },
        { p: 'versusPauseSec', t: 'num', l: 'Pause entre deux combats (s)', min: 1, max: 60 },
      ] },
      { title: 'Raids', fields: [
        { p: 'raidDaily', t: 'bool', l: 'Raid du jour' },
        { p: 'raidLegendary', t: 'bool', l: 'Raids légendaires (zones terminées)' },
        { p: 'raidMaxTries', t: 'num', l: 'Essais max par raid et par jour', min: 1, max: 50 },
        { p: 'raidAutoTeam', t: 'bool', l: 'Choisir l’équipe de raid contre le boss' },
        { p: 'raidFriends', t: 'bool', l: 'Ajouter des amis au groupe (compte connecté)' },
        { p: 'raidMinOdds', t: 'pct', l: 'Arrêter après 2 défaites si dégâts estimés <', h: 'Dégâts attendus du groupe / PV totaux du boss.' },
        { p: 'raidTrain', t: 'bool', l: '↳ puis entraîner au Centre un contre du boss' },
      ] },
      { title: 'Événements et routines (tous modes)', fields: [
        { p: 'eventWheel', t: 'bool', l: 'Roue de la fortune : tour gratuit du jour' },
        { p: 'dayCare', t: 'bool', l: 'Pension : faire éclore les Œufs et déposer un couple' },
        { p: 'dayCareCheckMin', t: 'num', l: '↳ y passer au plus toutes les N min', min: 5, max: 600, step: 5 },
        { p: 'rebattle', t: 'bool', l: 'Revanche du Conseil 4 quand l’équipe est prête' },
        { p: 'rebattleReadyScore', t: 'num', l: '↳ duel moyen exigé', min: 0.5, max: 4, step: 0.05 },
        { p: 'rebattleMaxTries', t: 'num', l: '↳ défaites max par jour', min: 1, max: 20 },
      ] },
    ], special: 'activity' },
    { tab: 'Bilan', icon: '📊', special: 'ledger' },
    { tab: 'Outils', icon: '🧰', groups: [
      { title: 'Affichage', fields: [
        { p: 'showStatus', t: 'bool', l: 'Afficher ce que fait le bot (ligne sous la barre)' },
        { p: 'showGoldRate', t: 'bool', l: 'Afficher l’or et les ₽ gagnés par heure' },
        { p: 'notify', t: 'bool', l: 'Notifications (chromatique, légendaire, boss, bot arrêté…)', h: 'Le navigateur demande l’autorisation au démarrage du bot.' },
        { p: 'notifySound', t: 'bool', l: '↳ avec un petit son' },
        { p: 'keepAwake', t: 'bool', l: 'Anti-veille : le PC ne se met pas en veille pendant que le bot tourne', h: 'Verrou d’écran du navigateur (Wake Lock). Garde l’onglet visible : réduit ou caché, le navigateur le libère.' },
      ] },
      { title: 'Planning', fields: [
        { p: 'schedule', t: 'text', l: 'Plages horaires', h: 'Exemple : 08:00-23:00=pokedex; 23:00-08:00=farm — modes : ' + Object.keys(MODES).join(', ') + '. Vide = désactivé.' },
      ] },
      { title: 'Vitesse & journal', fields: [
        { p: 'shortAnimations', t: 'bool', l: 'Animations courtes (au prochain rechargement)' },
        { p: 'actionCooldownMs', t: 'num', l: 'Attente max après une action (ms)', min: 200, max: 3000, step: 50 },
        { p: 'reportMinutes', t: 'num', l: 'Bilan dans le journal toutes les N min', min: 1, max: 120 },
        { p: 'autoResume', t: 'bool', l: 'Reprendre après un rechargement de la page' },
        { p: 'debug', t: 'bool', l: 'Journal détaillé dans la console' },
      ] },
    ], special: 'tools' },
  ];

  /* ═════════════════════════════ 9. UI ═════════════════════════════ */
  // Le panneau vit dans un Shadow DOM : le jeu (et les recherches de boutons du bot) ne le voient pas,
  // et ses mises à jour ne réveillent pas le MutationObserver.
  const CSS = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace}
    .wrap{position:fixed;left:8px;top:8px;z-index:99999;display:flex;flex-direction:column;gap:3px;max-width:min(94vw,440px);pointer-events:none}
    .row{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
    .chip,button,select{pointer-events:auto;font-size:11px;padding:4px 7px;border-radius:6px;border:2px solid #24304f;background:#f7f2e0;color:#24304f}
    button{cursor:pointer;font-weight:bold}
    button.on{background:#e5533d;color:#fff}
    .chip{display:flex;align-items:center;gap:3px}
    .gold{font-weight:bold}
    .line{font-size:10px;background:rgba(36,48,79,.88);color:#fff;padding:2px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .panel{pointer-events:auto;background:#f7f2e0;color:#24304f;border:2px solid #24304f;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.3);max-height:72vh;display:flex;flex-direction:column;width:min(94vw,440px)}
    .tabs{display:flex;flex-wrap:wrap;gap:2px;padding:4px;border-bottom:2px solid #24304f}
    .tabs button{border-width:1px;padding:3px 6px;font-weight:normal}
    .tabs button.sel{background:#24304f;color:#f7f2e0}
    .body{overflow:auto;padding:6px 8px 10px}
    h4{margin:8px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#e5533d}
    label.f{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;padding:2px 0;border-bottom:1px dotted #c9c0a3}
    label.f span{flex:1}
    input[type=text]{width:190px;font-size:11px;padding:2px 4px;border:1px solid #24304f;border-radius:4px;background:#fff;color:#24304f}
    input[type=number]{width:70px;font-size:11px;padding:2px 4px;border:1px solid #24304f;border-radius:4px;background:#fff;color:#24304f}
    input[type=checkbox]{width:15px;height:15px;accent-color:#e5533d}
    label.f select{max-width:190px;padding:2px;border-width:1px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    td{padding:2px 4px;border-bottom:1px dotted #c9c0a3}
    td.n{text-align:right;font-weight:bold}
    .btns{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
    textarea{width:100%;height:70px;font-size:10px;border:1px solid #24304f;border-radius:4px}
    .muted{font-size:10px;opacity:.75;margin:4px 0}
    .pos{color:#1d7a3a}.neg{color:#b3261e}
  `;
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'style') Object.assign(e.style, v); else if (k.startsWith('on')) e[k] = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v); }
    for (const c of kids.flat()) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  };

  const ui = {
    host: null, root: null, box: null, btn: null, line: null, modeSel: null, areaSel: null, lockBox: null, goldChip: null, panel: null, tab: 0, timer: null,
    mount() {
      this.host = h('div', { 'data-pokebot': '1' });
      this.root = this.host.attachShadow ? this.host.attachShadow({ mode: 'open' }) : this.host;
      this.root.append(h('style', {}, CSS));
      this.box = h('div', { className: 'wrap' });
      this.btn = h('button', { onclick: () => bot.toggle(), title: 'Démarrer / arrêter (Alt+B)' });
      this.modeSel = h('select', { title: 'Mode du bot', onchange: () => { setMode(this.modeSel.value, { farmAreaId: this.modeSel.value === 'farm' ? readSave()?.currentAreaId : undefined }); this.fillAreas(); } });
      for (const [k, m] of Object.entries(MODES)) this.modeSel.add(new Option(m.label, k));
      this.areaSel = h('select', { title: 'Zone de farm', onfocus: () => this.fillAreas(), onchange: () => setMode('farm', { farmAreaId: this.areaSel.value }) });
      this.lockBox = h('input', { type: 'checkbox', onchange: () => setTeamLock(this.lockBox.checked) });
      const lock = h('label', { className: 'chip', title: 'Équipe verrouillée : le Centre ne change ni la composition ni le meneur' }, this.lockBox, '🔒');
      this.goldChip = h('span', { className: 'chip gold', title: 'Or actuel · gains par heure (registre du bot)' }, '₽ —');
      const gear = h('button', { title: 'Réglages (dépenses, stocks, combat, captures…) et bilan', onclick: () => this.togglePanel() }, '⚙️');
      this.line = h('div', { className: 'line', style: { display: 'none' } });
      this.panel = h('div', { className: 'panel', style: { display: 'none' } });
      this.box.append(h('div', { className: 'row' }, this.btn, this.modeSel, this.areaSel, lock, this.goldChip, gear), this.line, this.panel);
      this.root.append(this.box);
      document.body.appendChild(this.host);
      this.refresh();
    },
    togglePanel(force) {
      const open = force ?? this.panel.style.display === 'none';
      this.panel.style.display = open ? 'flex' : 'none';
      clearInterval(this.timer);
      if (open) { this.renderPanel(); this.timer = setInterval(() => { if (PANEL[this.tab].special === 'ledger') this.renderPanel(); }, 3000); }
    },
    renderPanel() {
      const body = this.panel.querySelector?.('.body');
      const scroll = body?.scrollTop ?? 0;
      const tabs = h('div', { className: 'tabs' }, PANEL.map((t, i) => h('button', { className: i === this.tab ? 'sel' : '', onclick: () => { this.tab = i; this.renderPanel(); } }, `${t.icon} ${t.tab}`)),
        h('button', { style: { marginLeft: 'auto' }, title: 'Fermer', onclick: () => this.togglePanel(false) }, '✕'));
      const b = h('div', { className: 'body' });
      const t = PANEL[this.tab];
      for (const g of t.groups ?? []) { b.append(h('h4', {}, g.title)); for (const f of g.fields) b.append(this.field(f)); }
      if (t.special === 'ledger') b.append(...this.ledgerView());
      if (t.special === 'tools') b.append(...this.toolsView());
      if (t.special === 'activity') b.append(...this.activityView());
      this.panel.replaceChildren(tabs, b);
      b.scrollTop = scroll;
    },
    field(f) {
      const v = getPath(CONFIG, f.p);
      let input;
      if (f.t === 'bool') input = h('input', { type: 'checkbox', checked: !!v, onchange: () => setOption(f.p, input.checked) });
      else if (f.t === 'sel') { input = h('select', { onchange: () => setOption(f.p, input.value) }); for (const [val, lab] of f.o) input.add(new Option(lab, val, false, val === v)); }
      else if (f.t === 'text') input = h('input', { type: 'text', value: v ?? '', placeholder: f.h?.split(' — ')[0] ?? '', onchange: () => setOption(f.p, input.value.trim()) });
      else {
        const pct = f.t === 'pct';
        input = h('input', { type: 'number', value: pct ? Math.round((v ?? 0) * 100) : v ?? 0, min: pct ? 0 : f.min ?? '', max: pct ? 300 : f.max ?? '', step: pct ? 5 : f.step ?? 1,
          onchange: () => { const n = Number(input.value); if (Number.isFinite(n)) setOption(f.p, pct ? n / 100 : n); } });
      }
      return h('label', { className: 'f', title: f.h ?? f.p }, h('span', {}, f.l + (f.t === 'pct' ? ' (%)' : '')), input);
    },
    ledgerView() {
      const s = Ledger.summary();
      const d = Ledger.data();
      const save = readSave();
      const row = (k, v, cls = '') => h('tr', {}, h('td', {}, k), h('td', { className: 'n ' + cls }, v));
      const spent = Object.entries(d.spent).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([k, v]) => row('  dépensé · ' + (FAMILY_LABEL[k] ?? k), '₽' + v));
      const used = Object.entries(d.used).filter(([, v]) => v).map(([k, v]) => row('  consommé · ' + (FAMILY_LABEL[k] ?? k), `${v} (${(Ledger.rate(k) ?? 0).toFixed(2)}/renc.)`));
      const plan = save ? ballPlan(save) : { species: [] };
      const wish = save ? shopWishlist(save) : [];
      const pick = save ? upgradeCandidates(save)[0] : null;
      const gpe = save ? goldPerEncounter(currentArea(save), save) : 0;
      return [
        h('h4', {}, `Depuis ${s.hours < 1 ? Math.round(s.hours * 60) + ' min' : s.hours.toFixed(1) + ' h'}`),
        h('table', {}, row('Or actuel', '₽' + (save?.gold ?? '?')), row('Gagné (combats)', `₽${s.income} · ₽${Math.round(s.perHour)}/h`, 'pos'),
          row('Rencontres', `${s.enc} · zone ≈ ₽${gpe.toFixed(1)}/renc.`), row('Dépensé', '₽' + s.spentTotal, 'neg'), ...spent,
          row('Revendu', '₽' + s.sold, 'pos'), row('Autres sorties (casino…)', '₽' + s.other, s.other ? 'neg' : ''), row('Solde net', (s.net >= 0 ? '+' : '') + '₽' + s.net, s.net >= 0 ? 'pos' : 'neg'), ...used),
        h('h4', {}, 'Prochains achats'),
        h('table', {}, wish.length ? wish.map((w) => row(`${Rt.t('item.' + w.key, w.key)}${w.urgent ? ' ⚠️' : ''}`, `×${w.qty} · ₽${w.qty * priceOf(w.key)}`)) : row('rien à acheter', '—')),
        h('div', { className: 'muted' }, plan.species.length ? 'Espèces à capturer : ' + plan.species.slice(0, 8).map((x) => `${Rt.nameOf(x.dex)} (diff. ${x.need} → ${x.key ? Rt.t('item.' + x.key, x.key) : 'Sans Ball'} ${Math.round(x.pct * 100)} %)`).join(', ') : 'Aucune espèce manquante dans les zones visées.'),
        h('div', { className: 'muted' }, pick ? `Amélioration la plus rentable : ${pick.label} (₽${pick.cost}) — budget améliorations ₽${upgradeBudget(save)}` : 'Aucune amélioration autorisée.'),
        ...this.statsView(),
        h('div', { className: 'btns' },
          h('button', { onclick: () => { Ledger.report(true); } }, '📝 Bilan dans le journal'),
          h('button', { onclick: () => { Ledger.reset(); log('📊 bilan remis à zéro'); this.renderPanel(); } }, '♻️ Remettre à zéro')),
      ];
    },
    statsView() {
      const d = Stats.data();
      const row = (k, v) => h('tr', {}, h('td', {}, k), h('td', { className: 'n' }, v));
      const hours = (Date.now() - d.since) / 36e5;
      const throws = Object.entries(d.throws).sort((a, b) => b[1].n - a[1].n).map(([k, t]) => row('  ' + k, `${t.ok}/${t.n} (${Math.round((t.ok / Math.max(1, t.n)) * 100)} %)`));
      return [
        h('h4', {}, `Statistiques depuis ${hours < 1 ? Math.round(hours * 60) + ' min' : hours.toFixed(1) + ' h'}`),
        h('table', {},
          row('Captures', `${d.caught} (dont ${d.newSpecies} nouvelles espèces)`),
          row('Chromatiques', `${d.shinyCaught} capturés / ${d.shinySeen} vus`),
          row('Lancers de Ball (réussis / lancés)', ''), ...throws,
          row('Raids', `${d.raidsWon} gagnés · ${d.raidsLost} perdus`),
          row('Œufs éclos', `${d.eggs}${d.shinyEggs ? ` (dont ${d.shinyEggs} chromatique${d.shinyEggs > 1 ? 's' : ''})` : ''}`),
          row('Roue de la fortune', `${d.spins} tour${d.spins > 1 ? 's' : ''}`),
          row('Revanche : victoires', String(d.rebattleWins))),
        h('div', { className: 'btns' }, h('button', { onclick: () => { Stats.reset(); log('📈 statistiques remises à zéro'); this.renderPanel(); } }, '♻️ Statistiques à zéro')),
      ];
    },
    activityView() {
      const save = readSave();
      const st = actState();
      const n50 = (save?.box ?? []).filter((m) => m.level >= 50).length;
      const best = n50 >= 3 ? bestVersusTeam(save, []) : null;
      const c = raidCfg();
      const r = save ? nextRaid(save) : null;
      return [
        h('h4', {}, 'État'),
        h('table', {},
          h('tr', {}, h('td', {}, 'Versus'), h('td', { className: 'n' }, n50 >= 3 ? `ouvert · ${st.vsWins ?? 0}/${st.vsFights ?? 0} victoires` : `verrouillé (${n50}/3 au N.50)`)),
          best ? h('tr', {}, h('td', {}, '  équipe conseillée'), h('td', { className: 'n' }, best.dex.map((d) => Rt.nameOf(d)).join(' → '))) : null,
          h('tr', {}, h('td', {}, 'Raid du jour'), h('td', { className: 'n' }, dailyRaidOpen(save) ? (st.raidDone === utcDay() ? 'fait aujourd’hui' : 'disponible') : `verrouillé (termine ${Rt.areaLabel(Rt.D.areas[c?.unlockAreaId])})`)),
          h('tr', {}, h('td', {}, 'Raids légendaires ouverts'), h('td', { className: 'n' }, String(save ? legendaryRaids(save).length : 0))),
          h('tr', {}, h('td', {}, 'Prochain raid'), h('td', { className: 'n' }, r ? (r.key === 'daily' ? 'raid du jour' : Rt.nameOf(r.dex)) : '—')),
          st.raidTrain?.until > Date.now() ? h('tr', {}, h('td', {}, '  entraînement raid'), h('td', { className: 'n' }, `contre ${Rt.nameOf(st.raidTrain.dex)}`)) : null,
          h('tr', {}, h('td', {}, 'Roue de la fortune'), h('td', { className: 'n' }, !eventOpen('wheel', save) ? 'fermée' : st.wheelDone === utcDay() ? 'tournée aujourd’hui' : 'tour gratuit dispo')),
          h('tr', {}, h('td', {}, 'Pension'), h('td', { className: 'n' }, !dayCareOpen(save) ? `verrouillée (${Rt.D.config.dayCare?.unlockPokedex ?? 20} espèces)` : dayCareOf(save).egg ? 'un Œuf attend' : (dayCareOf(save).residents ?? []).map((x) => Rt.nameOf(x.inst?.dex)).join(' + ') || 'vide')),
          h('tr', {}, h('td', {}, 'Revanche du Conseil 4'), h('td', { className: 'n' }, (() => { const rb = save && eventOpen('rebattle', save) ? rebattleState(save) : null; return rb ? `palier ${rb.tier.id}, combat ${rb.step + 1}` : 'fermée ou terminée'; })()))),
        mem.vsField?.length && n50 >= 3 ? (() => { const d = bestDefenseTeam(save, mem.vsField); return d ? h('div', { className: 'muted' }, `Défense conseillée : ${d.dex.map((x) => Rt.nameOf(x)).join(' → ')} — repousse ${d.held}/${d.total} équipes connues`) : null; })() : null,
        st.vsDefenseAt ? h('div', { className: 'muted' }, `Dernière équipe de défense : ${new Date(st.vsDefenseAt).toLocaleString()}`) : null,
        h('div', { className: 'btns' },
          h('button', { title: 'Rassemble toutes les équipes adverses connues et enregistre la tienne qui repousse le plus d’attaques', onclick: () => { requestDefenseTeam(); this.togglePanel(false); } }, '🛡️ Créer la meilleure équipe de défense'),
          h('button', { onclick: () => { setActState({ vsNext: 0, raidSkip: {}, raidTries: null, raidDone: null }); mem.actLog = null; log('🔁 Versus / Raids : attentes remises à zéro'); this.renderPanel(); } }, '🔁 Réessayer maintenant')),
      ];
    },
    toolsView() {
      const ta = h('textarea', { placeholder: 'Colle ici des réglages exportés puis « Importer »' });
      const copy = async (txt, what) => { try { await navigator.clipboard.writeText(txt); log(`📋 ${what} copié`); } catch { ta.value = txt; log(`📋 ${what} affiché dans la zone de texte`); } };
      const download = (name, txt) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
      return [
        h('h4', {}, 'Actions'),
        h('div', { className: 'btns' },
          h('button', { onclick: () => { mem.forceChores = true; mem.lastChoresGold = -1; log('🛒 courses demandées : au prochain passage hors combat'); } }, '🛒 Courses maintenant'),
          h('button', { onclick: () => { try { localStorage.removeItem(BOSS_KEY); } catch {} log('🏆 compteur de défaites contre les boss remis à zéro'); } }, '🏆 Oublier les défaites boss'),
          h('button', { onclick: () => { mem.travelFail.clear(); mem.evolveTried?.clear(); log('🗺️ zones / évolutions en échec réarmées'); } }, '🔁 Réarmer zones')),
        h('h4', {}, 'Journal'),
        h('div', { className: 'btns' },
          h('button', { onclick: () => copy(journal.join('\n'), 'journal') }, '📋 Copier le journal'),
          h('button', { onclick: () => download(`pokebot-journal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, journal.join('\n')) }, '💾 Télécharger')),
        h('h4', {}, 'Réglages'),
        h('div', { className: 'muted' }, 'Pour partager tes réglages avec tes amis : Exporter, puis eux Importer.'),
        ta,
        h('div', { className: 'btns' },
          h('button', { onclick: () => copy(JSON.stringify(readSettings(), null, 1), 'réglages') }, '📤 Exporter'),
          h('button', { onclick: () => {
            try { const s = JSON.parse(ta.value); if (typeof s !== 'object' || !s) throw new Error('format'); localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); loadSettings(); this.renderPanel(); log('📥 réglages importés'); }
            catch (e) { log('⚠️ import impossible : ' + e.message); }
          } }, '📥 Importer'),
          h('button', { onclick: () => { resetOptions(); this.renderPanel(); } }, '♻️ Réglages d’usine')),
      ];
    },
    /** Zones ouvertes de la région courante (nom localisé), pour choisir où farmer. */
    fillAreas() {
      if (!this.areaSel || !Rt.E) return;
      const save = readSave();
      const region = currentArea(save)?.regionId ?? save?.region;
      const opts = Rt.D.areaList.filter((a) => a.regionId === region && save?.areaProgress?.[a.id]);
      this.areaSel.replaceChildren(...opts.map((a) => {
        const miss = missingSpecies(a, save).length;
        const g = goldPerEncounter(a, save);
        return new Option(`${Rt.areaLabel(a)}${save.areaProgress[a.id]?.cleared ? ' ✓' : ''}${miss ? ` (${miss} à capturer)` : ''}${g ? ` ₽${g.toFixed(1)}` : ''}`, a.id, false, a.id === CONFIG.farmAreaId);
      }));
    },
    status(txt) { if (this.line) { this.line.textContent = txt; this.line.style.display = bot.running && CONFIG.showStatus ? 'block' : 'none'; } },
    refresh(reason) {
      if (!this.btn) return;
      this.btn.textContent = bot.running ? `🤖 ON · ${bot.stats.actions}` : `🤖 OFF${reason ? ' · ' + reason : ''}`;
      this.btn.className = bot.running ? 'on' : '';
      this.line.style.display = bot.running && CONFIG.showStatus ? 'block' : 'none';
      if (this.goldChip) this.goldChip.style.display = CONFIG.showGoldRate ? '' : 'none';
      if (this.modeSel) this.modeSel.value = CONFIG.activity ?? CONFIG.modeKey ?? CONFIG.mode;
      if (this.lockBox) this.lockBox.checked = !!CONFIG.lockTeam;
      if (this.areaSel) {
        this.areaSel.style.display = CONFIG.mode === 'farm' && CONFIG.farmGoal === 'xp' ? '' : 'none';
        if (CONFIG.mode === 'farm' && !this.areaSel.options.length) this.fillAreas();
      }
      if (this.goldChip && Ledger.d) { const g = readSave()?.gold; this.goldChip.textContent = `₽${g ?? '—'} · +${Math.round(Ledger.perHour().income)}/h`; }
    },
  };

  document.addEventListener('keydown', (e) => { if (e.altKey && e.key.toLowerCase() === 'b') bot.toggle(); });
  /**
   * Barre de secours, sans Shadow DOM ni style élaboré : si l'interface normale ne peut pas s'afficher
   * (navigateur mobile, extension plus stricte…), on garde au moins ON/OFF et le choix du mode.
   */
  function mountFallback(err) {
    console.warn('[PokéBot] interface normale indisponible, barre de secours', err);
    const bar = document.createElement('div');
    bar.setAttribute('data-pokebot', '1');
    bar.style.cssText = 'position:fixed;left:6px;top:6px;z-index:2147483647;display:flex;gap:6px;font:bold 14px sans-serif';
    const b = document.createElement('button');
    b.style.cssText = 'padding:10px 14px;border:2px solid #24304f;border-radius:8px;background:#f7f2e0;color:#24304f';
    const sel = document.createElement('select');
    sel.style.cssText = 'padding:8px;border:2px solid #24304f;border-radius:8px;background:#f7f2e0;color:#24304f';
    for (const [k, m] of Object.entries(MODES)) sel.add(new Option(m.label, k));
    sel.onchange = () => setMode(sel.value);
    b.onclick = () => bot.toggle();
    bar.append(b, sel);
    document.body.appendChild(bar);
    ui.host = bar; ui.btn = b; ui.modeSel = sel;
    ui.line = { style: {}, textContent: '' };
    ui.refresh = function () { b.textContent = bot.running ? `🤖 ON · ${bot.stats.actions}` : '🤖 OFF'; b.style.background = bot.running ? '#e5533d' : '#f7f2e0'; b.style.color = bot.running ? '#fff' : '#24304f'; sel.value = CONFIG.activity ?? CONFIG.modeKey ?? CONFIG.mode; };
    ui.status = () => {};
    ui.fillAreas = () => {};
    ui.refresh();
  }
  const mountUi = () => {
    if (!document.body) return setTimeout(mountUi, 200);
    try { ui.mount(); if (!ui.host?.isConnected) throw new Error('barre non attachée'); }
    catch (e) { try { ui.host?.remove?.(); } catch {} mountFallback(e); }
  };
  mountUi();
  // React peut reconstruire le <body> au démarrage : si la barre disparaît, on la remet
  setTimeout(() => { if (ui.host && !ui.host.isConnected) document.body.appendChild(ui.host); }, 3000);
  console.info('[PokéBot] Pokédice Autopilot chargé — barre en haut à gauche');
  Rt.load().then(() => {
    bot.ready = true; Ledger.load(); loadSettings(); ui.fillAreas(); ui.refresh();
    if (CONFIG.autoResume && readSettings().running) { log('🔄 page rechargée : le bot reprend'); bot.start(); }
  });

  // Menu de l'extension Tampermonkey (icône de l'extension → Pokédice Autopilot)
  if (typeof GM_registerMenuCommand === 'function') {
    const menu = (label, fn) => { try { GM_registerMenuCommand(label, fn); } catch {} };
    menu('▶/⏸ Démarrer / arrêter (Alt+B)', () => bot.toggle());
    menu('⚙️ Réglages et bilan', () => ui.togglePanel(true));
    for (const [k, m] of Object.entries(MODES)) menu(`🎛️ Mode ${m.label}`, () => setMode(k, { farmAreaId: k === 'farm' ? readSave()?.currentAreaId : undefined }));
    menu('💰 Farm à ₽ (zone la plus rentable)', () => { setOption('farmGoal', 'gold'); setMode('farm'); });
    menu('🛒 Courses maintenant', () => { mem.forceChores = true; mem.lastChoresGold = -1; });
    menu('📊 Bilan dans le journal', () => Ledger.report(true));
    menu('🛡️ Versus : meilleure équipe de défense', () => requestDefenseTeam());
    menu('🎡 Roue / 🥚 Pension : y aller maintenant', () => { setActState({ wheelDone: null }); mem.dayCareAt = 0; });
  }

  const api = { itemEvolutions, evolutionTargets, healTierFor, shopTiers, bot, CONFIG, MODES, DEFAULTS, setMode, setOption, resetOptions, setTeamLock, bossMatchup, bossTeam, journal, Rt, mem, readBattle, teamMons, boxMons,
    upgradeCandidates, upgradePick, xpShare, usefulXp, pickTrainees, xpTeamPlan, xpPerEncounter, bestXpArea, multiExpOn, shopWishlist, shopPlan, chores, noteDexProgress, sellList, voluntarySwitch, teamFight, fastDmg, bestVersusTeam, bestDefenseTeam, requestDefenseTeam, raidValue, nextRaid, legendaryRaids, dailyRaidOpen, activityTick, actState, ballPlan, catchPct, catchNeed, chooseBall, shouldHeal, pickHeal, goldPerEncounter, bestGoldArea, generalWish, Ledger, ui,
    areaThreats, missingSpecies, desiredArea, buildData, Engine,
    obtainedDex, fossilTargets, catchTargetDex, targetArea, wantLuck, canBreed, dayCarePick, dayCareDue, eventOpen, rebattleState, rebattleMatchup, rebattleDue,
    raidBossHp, raidOdds, raidTrainee, parseSchedule, scheduledMode, Stats, noteCatchResult, notify, WakeLock };
  root.PokeBot = api;
  // Hook de débogage : évalue du code DANS la portée du script (permet de patcher une fonction à chaud).
  root.PokeBot.__eval = (src) => eval(src); // eslint-disable-line no-eval
})();
