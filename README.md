# Pokédice Autopilot

Bot Tampermonkey qui joue à [Pokédice](https://poke-dice.netlify.app/) à votre place : combats optimisés, soins, captures, boutique, améliorations, Centre Pokémon, changement de zone, Versus et Raids.

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/) (ou Violentmonkey).
2. Créer un nouveau script et coller le contenu de `pokedice-bot.user.js`, ou l'ouvrir directement depuis le gestionnaire.
3. Ouvrir https://poke-dice.netlify.app/ : une barre apparaît en haut à gauche.

La dernière version publiée peut aussi être téléchargée directement : https://github.com/AlexTournant/poke-dice/releases/latest/download/pokedice-bot.user.js

## Utilisation

| Élément | Rôle |
|---|---|
| 🤖 ON / OFF | Démarre ou arrête le bot. Raccourci : `Alt+B` |
| Sélecteur de mode | Progression, Pokédex (captures / évolutions), Farm, Versus, Raids |
| Sélecteur de zone | Zone de farm (mode Farm uniquement) |
| 🔒 | Verrouille l'équipe : le Centre ne change ni la composition ni le meneur |
| ₽ | Or actuel et gains par heure (si activé dans les réglages) |
| ⚙️ | Panneau de réglages (dépenses, stocks, combat, captures, zones, Versus/Raids) et bilan financier |

Le menu de l'extension Tampermonkey donne accès aux mêmes actions (démarrer, réglages, modes, courses, bilan, équipe de défense Versus).

### Modes

- **Progression** : enchaîne les zones et les arènes.
- **Pokédex : captures** : reste dans les zones où il manque des espèces sauvages, capture les espèces nouvelles avec la Ball la moins chère qui suffit.
- **Pokédex : évolutions** : recapture les espèces qui débloquent une évolution par niveau manquante, entraîne le Pokémon le plus proche du palier, utilise les pierres possédées.
- **Farm** : reste dans une zone choisie (XP, ₽, chromatiques), avec l'équipe verrouillée. Objectif « ₽ » : choisit la zone la plus rentable.
- **Versus** : compose une équipe taillée contre chaque adversaire (3 Pokémon au N.50, compte connecté requis), sinon joue dans le mode de repli.
- **Raids** : raid du jour et raids légendaires des zones terminées, avec une équipe composée contre le boss.

### Économie

Seuls les dresseurs et les arènes paient. Le bot :

- mesure sa consommation réelle de soins et de Balls, et dimensionne les stocks en conséquence ;
- achète la Ball qui atteint la chance de capture voulue, pas la plus forte ;
- épargne pour l'amélioration la plus rentable plutôt que d'acheter les petites ;
- revend les surplus à moitié prix.

Un registre (onglet « Bilan » du panneau) suit les gains, dépenses et consommations.

## Tests

Aucune dépendance : Node 18+ suffit.

```bash
npm test          # moteur pur + décisions métier
npm run check     # syntaxe du script
```

Les tests de `test/` chargent le script dans un faux DOM (`test/dom-stub.js`) et s'appuient sur une sauvegarde simulée.

La CI (GitHub Actions) lance les mêmes contrôles à chaque pull request et bloque la fusion en cas d'échec : voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Versions

Le numéro de version est dans l'en-tête `@version` du script. Les changements sont listés dans [CHANGELOG.md](CHANGELOG.md). Chaque version est publiée par tag (`vX.Y.Z`) avec une release GitHub : voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Mise à jour automatique (optionnel)

Pour que Tampermonkey mette le script à jour depuis le dépôt, ajouter dans l'en-tête, à l'URL *raw* du fichier :

```js
// @updateURL    https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js
```

La branche `main` est protégée : elle ne reçoit que du code validé par la CI. Chaque modification du script doit incrémenter `@version`, sinon Tampermonkey ne proposera pas la mise à jour.

## Avertissements

- Le bot automatise une partie de jeu dans un navigateur. Vérifier les conditions d'utilisation du site avant usage prolongé.
- Garder l'onglet visible : Chrome ralentit fortement les onglets en arrière-plan et le bot joue beaucoup plus lentement.
- Le compte du jeu n'est pas utilisé en dehors du navigateur. Aucune donnée n'est envoyée ailleurs que vers le jeu.
