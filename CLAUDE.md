# CLAUDE.md — Pokédice Autopilot

Userscript Tampermonkey qui joue à Pokédice (https://poke-dice.netlify.app/) à la place du joueur : combats optimisés, soins, captures, boutique, améliorations, Centre, zones, Versus et Raids.

Ce fichier décrit comment travailler sur le projet. Le détail fonctionnel est dans `README.md`, le flux de publication dans `CONTRIBUTING.md`.

## Structure

```
poke-dice/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # CI : syntaxe, tests, @version à chaque PR
│   │   └── release.yml         # release GitHub à chaque tag vX.Y.Z
│   └── pull_request_template.md
├── scripts/
│   └── check-version.js        # contrôles de version (PR, tag) et notes de release
├── CHANGELOG.md                # une section ## [X.Y.Z] par version
├── CONTRIBUTING.md             # flux PR, publication, protections GitHub
├── INSTALLATION.md             # installation Tampermonkey et mises à jour automatiques
├── package.json                # scripts npm uniquement (aucune dépendance)
├── pokedice-bot.user.js        # LE script (à installer dans Tampermonkey)
├── pokedice-bot.test.js        # tests du moteur (pur, sans DOM)
├── fixtures/
│   └── brock.json              # données réelles relevées en jeu (boss Pierre)
└── test/
    ├── decisions.test.js       # tests des décisions métier (boutique, captures, Pokédex, Versus, Raids)
    └── dom-stub.js             # faux DOM minimal pour charger le script sous Node
```

## Commandes

```bash
npm test          # moteur (dégâts, combos, statuts, relances, performance) + décisions (boutique, captures, Pokédex, Versus, Raids)
npm run check     # syntaxe du script
```

Lancer `npm test` avant toute PR : la CI le refait et bloque la fusion si ça échoue. Aucune dépendance npm : `package.json` ne sert qu'à lancer Node.

## Architecture du script

`pokedice-bot.user.js` est un IIFE organisé en 9 sections (numérotées dans les commentaires) :

1. **CONFIG** — tous les réglages (valeurs d'usine dans `CONFIG`, modes dans `MODES`).
2. **Data** — données du jeu lues au runtime depuis IndexedDB (`pokedice` / `content`) et les libellés i18n du bundle, avec repli embarqué (`FALLBACK`).
3. **Engine** — **pur, sans DOM** : stats d'espèce (`speciesAt`), dégâts (port de la fonction `Qc` du jeu), statuts, soin, espérance de relance (`chooseReroll`), score de duel (`duelScore`).
4. **Dom** — helpers : boutons reconnus par leur libellé i18n, lecture de la sauvegarde.
5. **Screens** — détection de l'écran courant (combat, rencontre, Centre, boutique…).
6. **Policies** — une politique par écran : battle, items, encounter, center, catch, victory, area, shop, upgrades, zones, Versus, Raids.
7. **Bot** — boucle `tick` pilotée par `MutationObserver`, verrou `busy`, garde-fous.
8. **Modes** — `progression`, `pokedex` (captures / évolutions), `farm`, `versus`, `raid`.
9. **UI** — barre ON/OFF + mode + 🔒 + ₽/h, panneau ⚙️ dans un Shadow DOM, menu Tampermonkey, raccourci Alt+B.

Console : `window.PokeBot` expose `bot`, `CONFIG`, `setMode('farm')`, `journal`, `Engine`, etc.

En Node (`module.exports` présent, pas de `document`), seuls `buildData`, `Engine`, `CONFIG` et `FALLBACK` sont exportés.

## Conventions

- **Engine = fonctions pures.** Aucun accès à `document`, `localStorage` ou `window` dans `Engine` ni dans `buildData`. Sinon les tests Node cassent.
- **Libellés via i18n.** Un bouton se reconnaît par `Rt.re('ui.…')` / `Rt.t('ui.…')`, jamais par un libellé français en dur (le français n'est qu'un repli).
- **Un écran = une politique.** Une nouvelle action se range dans la politique de l'écran concerné et `playBattle`/`playEncounter`/… ne font qu'appeler des sous-fonctions.
- **Réglages joueur** : persistés dans `localStorage['pokebot.settings']` (`cfg`, `lock`, `mode`, `farmAreaId`, `running`). Toute nouvelle option doit aussi apparaître dans `PANEL` pour être réglable.
- **Clés localStorage existantes** : `pokebot.settings`, `pokebot.bossFails`, `pokebot.dexStall`, `pokebot.activity`, `pokebot.ledger`, `pokebot.general`. Ne pas renommer une clé sans migration.
- **Versionner** : toute modification du script incrémente `@version` (SemVer) et ajoute une section `## [X.Y.Z]` dans `CHANGELOG.md`. La CI le vérifie (`scripts/check-version.js --base`). Une version se publie par tag `vX.Y.Z` (workflow Release). Tampermonkey ne propose une mise à jour que si la version augmente (`@updateURL` / `@downloadURL` suivent `main`). Ne jamais changer `@name`, `@namespace` ni ces URL : les joueurs perdraient les mises à jour.
- **Mots-clés de langue** : le bundle du jeu contient plusieurs langues (`LANGS`) ; le script choisit celle de `save.settings.lang`.

## Pièges connus (documentés dans le code)

- **Calcul des dégâts moyens** : énumération exacte jusqu'à `CONFIG.exactEnumLimit` (1 296 issues = 6⁴), échantillonnage déterministe au-delà (graine fixe → décisions stables). Un calcul exact à 6 dés gelait la page pendant plus d'une minute avant la v0.5. Le test de performance dans `pokedice-bot.test.js` protège ce point.
- **Versus** : la recherche d'équipe présélectionne 8 candidats puis teste 336 équipes ordonnées. Ne pas remplacer par une énumération complète.
- **`area.gyms`** est une liste d'identifiants (chaînes), pas d'objets. Corrigé en v0.6 : le bot lisait `g.trainerId` et ignorait les équipes de boss.
- **Relance** : jamais si le lancer tue déjà l'adversaire (`reason: 'kill'`).
- **Animations** : le réglage « Animations : Courtes » est appliqué par `localStorage` et ne prend effet qu'au rechargement. « Aucune animation » est réservé aux admins du jeu : ne pas y toucher.
- **Changement de zone** refusé par le jeu tant qu'une rencontre est ouverte : `resumeEncounter` la termine d'abord.
- **Onglet en arrière-plan** : Chrome ralentit fortement le jeu (tours ×3 mesurés). Le journal en avertit.
- **Tests partagés** : `decisions.test.js` modifie un état global (`PokeBot.CONFIG`, `localStorage`). Les tests dépendent de l'ordre d'exécution ; remettre `setMode(…, { persist: false })` et `setOption(…, { persist: false })` au début de chaque test qui change un réglage.

## Données de test

- `fixtures/brock.json` contient des valeurs relevées en jeu (table d'efficacité, espèces, niveaux du boss Pierre). Ne pas modifier à la main : le recréer depuis une partie réelle si les données du jeu changent.
- Les cas « observés » de `pokedice-bot.test.js` sont des lancers dont les dégâts affichés par le jeu ont été relevés. Si un test casse après un changement de formule, vérifier d'abord la formule contre le jeu avant de changer le test.

## Ce qu'il ne faut pas faire

- Ne pas ajouter de dépendance npm : le script doit rester un fichier unique installable dans Tampermonkey.
- Ne pas automatiser ce que le jeu réserve aux administrateurs (« Aucune animation », etc.).
- Ne pas committer de cookie, de token ni de sauvegarde personnelle (`localStorage` du jeu).
- Ne pas pousser directement sur `main` : passer par une pull request dont la CI est verte. Ne pas poser un tag `vX.Y.Z` qui ne correspond pas à `@version`.
