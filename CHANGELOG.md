# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en [SemVer](https://semver.org/lang/fr/).

Chaque section `## [X.Y.Z]` correspond à un tag `vX.Y.Z`. Les notes de la release GitHub sont extraites de cette section.

## [Non publié]

## [1.5.1]

### Ajouté

- Mise à jour automatique dans Tampermonkey : `@updateURL` et `@downloadURL` pointent vers le script de la branche `main`.
- `@homepageURL` et `@supportURL` (dépôt et tickets GitHub), affichés dans le tableau de bord Tampermonkey.
- `INSTALLATION.md` : installation depuis l'URL, migration d'un script collé à la main, réglages de Tampermonkey, dépannage.

## [1.5.0]

### Corrigé

- Mode Pokédex : le bot restait dans une zone affichée « Tous capturés ». Il comptait les fossiles de la zone (espèces de poids nul, jamais rencontrées). Il ne retient maintenant que les espèces de poids > 0, comme le jeu.
- Mode Pokédex : un fossile en train de revivre (24 h) compte comme obtenu. Le bot passe à la zone suivante sans attendre son réveil et n'achète plus de Balls pour cette espèce.
- Centre : un fossile en train de revivre n'est plus proposé pour l'équipe.
- Raids : les multiplicateurs de type étaient inversés. Nos coups super efficaces font ×1,3 (pas ×2) ; ceux du boss font ×2, résistés ×0,7, immunité ×0,5. La défense compte donc davantage dans le choix de l'équipe.
- Raids : la valeur d'un Pokémon utilise les améliorations imposées par le raid (niveau 5 pour les joueurs, 8 pour le boss) et le niveau plafond (N.50), au lieu de celles de la sauvegarde.
- Raids en combat : relances calculées avec les règles du raid et les PV réels d'une barre du boss (`barHp`).

### Modifié

- Raids : les alliés PNJ sont choisis sur les dégâts que leur équipe infligera au boss avant K.O., et non plus sur le nombre de types super efficaces.
- Capture : une nouvelle espèce reçoit la Ball qui donne la meilleure chance (`catchNewPct` passe de 90 à 100 %). Le bot achète les Balls en conséquence.

## [1.4.0]

Première version suivie dans Git, avec CI (tests, syntaxe, `@version`) et publication par tag. L'historique des versions précédentes n'a pas été reconstitué.
