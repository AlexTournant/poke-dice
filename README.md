# Pokédice Autopilot

Bot Tampermonkey qui joue à [Pokédice](https://poke-dice.netlify.app/) à votre place : combats optimisés, soins, captures, boutique, améliorations, Centre Pokémon, changement de zone, Versus et Raids.

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/) (ou Violentmonkey).
2. Ouvrir https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js et cliquer sur **Installer**.
3. Ouvrir https://poke-dice.netlify.app/ : une barre apparaît en haut à gauche.

Installé ainsi, le script se met à jour automatiquement. Pas à pas, migration d'un script collé à la main, réglages de Tampermonkey et dépannage : [INSTALLATION.md](INSTALLATION.md).

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
- **Pokédex : captures** : reste dans les zones où il manque des espèces sauvages et capture chaque nouvelle espèce avec la meilleure chance disponible (Ball, appât, amélioration « Chance de capture »), même si c'est une Hyper Ball. Il ne fait évoluer un Pokémon que si son évolution directe manque au Pokédex et ne se capture pas facilement en sauvage. Les fossiles en cours de réveil comptent comme obtenus ; les fossiles d'espèces manquantes sont achetés ou cherchés dans leur zone.
- **Pokédex : évolutions** : recapture les espèces qui débloquent une évolution manquante (par niveau ou par pierre), entraîne le Pokémon le plus proche du palier, utilise les pierres possédées et achète les autres. S'il manque de l'or pour une pierre, il va farmer les ₽ dans la zone la plus rentable.
- **Farm** : reste dans une zone choisie (XP, ₽, chromatiques), avec l'équipe verrouillée. Objectifs automatiques : « XP » (zone qui rapporte le plus d'XP sans risque) ou « ₽ » (zone la plus rentable).
- **Versus** : compose une équipe taillée contre chaque adversaire (3 Pokémon au N.50, compte connecté requis), sinon joue dans le mode de repli.
- **Raids** : raid du jour et raids légendaires des zones terminées. L'équipe, les alliés PNJ et les amis sont choisis sur les dégâts infligés au boss (règles de type du raid). Si l'estimation prévoit une défaite nette, le bot arrête pour la journée et entraîne un « contre » au Centre.

Dans tous les modes, une **espèce visée** (onglet Captures) emmène le bot dans la zone où elle apparaît le plus, jusqu'à sa capture.

### XP : porteur et élèves (tous modes)

Le jeu partage l'XP (Multi Exp) : un Pokémon de l'équipe qui ne combat pas reçoit 30 % de l'XP, plus 5 % par niveau d'écart avec le combattant. Au moins 14 niveaux plus bas, il reçoit donc 100 %. Au Centre, le Pokémon le plus fort **porte** l'équipe et les autres places vont à des **élèves** de la Boîte, choisis dans cet ordre : évolution qui manque au Pokédex, Versus (N.50), contre d'un raid perdu, meilleur potentiel. Le meneur est choisi pour l'XP utile : plus d'XP perdue sur des Pokémon au niveau 100.

### Régions

Une fois la Ligue battue, le bot passe à la région suivante (Progression, Farm, et Pokédex : captures quand la région n'a plus d'espèce à capturer). Il choisit le partenaire réglé pour chaque région dans l'onglet « Équipe & zones » (par défaut, le meilleur potentiel).

### Routines (tous modes)

- **Roue de la fortune** : le tour gratuit du jour.
- **Pension** : fait éclore les Œufs (l'espèce est tirée au hasard, 4× plus souvent parmi celles qui manquent au Pokédex) et y dépose un couple compatible de la Boîte, choisi parmi les plus bas niveaux.
- **Revanche du Conseil 4** : le Centre compose l'équipe qui bat tout le palier (5 combats sans Centre ni changement d'équipe), puis le bot enchaîne les combats ; il s'arrête après N défaites par jour.

### Confort

- **Notifications** du navigateur (avec un petit son) : chromatique, légendaire, boss battu, raid réussi, Œuf chromatique, bot arrêté.
- **Anti-veille** : tant que le bot tourne et que l'onglet est visible, l'écran ne s'éteint pas et le PC ne se met pas en veille (verrou d'écran du navigateur). Ça ne protège pas d'une fermeture du capot.
- **Planning** : change de mode selon l'heure, par exemple `08:00-23:00=pokedex; 23:00-08:00=farm`.
- **Statistiques** (onglet Bilan) : captures, chromatiques, taux de réussite de chaque Ball, raids, Œufs, tours de roue.

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

## Mise à jour automatique

L'en-tête du script contient `@updateURL` et `@downloadURL`, qui pointent vers le fichier de la branche `main`. Tampermonkey vérifie cette URL régulièrement et installe toute version dont `@version` est plus grande.

La branche `main` est protégée : elle ne reçoit que du code validé par la CI. Chaque modification du script doit incrémenter `@version`, sinon Tampermonkey ne proposera pas la mise à jour. Détails et dépannage : [INSTALLATION.md](INSTALLATION.md).

## Avertissements

- Le bot automatise une partie de jeu dans un navigateur. Vérifier les conditions d'utilisation du site avant usage prolongé.
- Garder l'onglet visible : Chrome ralentit fortement les onglets en arrière-plan et le bot joue beaucoup plus lentement.
- Le compte du jeu n'est pas utilisé en dehors du navigateur. Aucune donnée n'est envoyée ailleurs que vers le jeu.
