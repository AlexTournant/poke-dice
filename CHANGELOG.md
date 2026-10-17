# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en [SemVer](https://semver.org/lang/fr/).

Chaque section `## [X.Y.Z]` correspond à un tag `vX.Y.Z`. Les notes de la release GitHub sont extraites de cette section.

## [Non publié]

## [1.10.0]

### Ajouté

- Mode « Revanche du Conseil 4 », à part, comme Versus et Raids (sélecteur de mode). Le Centre compose la meilleure équipe possible contre tout le palier, même sous le seuil de préparation. Le bot ouvre ensuite la revanche depuis sa carte de l'accueil (« Revanche du Conseil 4, palier Bronze : ensuite, … Ouvrir ») et enchaîne les combats. Un palier commencé (« Combat 2 sur 5 ») se continue tel quel. Défaites : au plus `rebattleMaxTries` par jour, puis le mode de repli joue en attendant le lendemain. Palier fini ou revanche fermée : le mode de repli joue.

## [1.9.0]

### Ajouté

- Revanche du Conseil 4 automatisée (`rebattle`, activée par défaut). Le palier s'enchaîne sans Centre ni changement d'équipe : le Centre compose d'abord l'équipe qui bat **tout** le palier. Pour chaque Pokémon des dresseurs restants, il cherche le meilleur duel de l'équipe, avec leurs améliorations (+ upgradeDelta du palier). Il maximise le pire duel puis la moyenne, en combinant les 8 meilleurs candidats. La revanche se lance quand cette équipe atteint `rebattleReadyScore`.
- Changement de région automatique (`autoRegion`) en Progression, Farm et Pokédex : captures. Il a lieu une fois la Ligue de la région battue (et, en captures, plus aucune espèce sauvage à capturer dans les zones ouvertes), jamais avant une Revanche prête. Le bot passe par la bannière « Voir {région} » ou Zones → Régions → « Entrer à {région} ».
- Partenaire par région (`starterPick`), réglable dans l'onglet « Équipe & zones » : la bonne Poké Ball, « Choisir », « C'est parti ! ». Par défaut, le starter dont la dernière évolution a le meilleur potentiel.

## [1.8.0]

### Ajouté

- Mode « Pokédex : évolutions » : les évolutions par pierre (et autres objets) sont prises en compte de bout en bout :
  - la base d'une évolution par objet qui manque au Pokédex devient une espèce à capturer (exemple : Pikachu pour Raichu) ;
  - il manque de l'or pour une pierre utile en vente → le bot va farmer les ₽ dans la zone ouverte la plus rentable et sans risque (`stoneGoldFarm`, activé) ;
  - l'or des pierres est réservé en entier : les améliorations attendent, et la boutique peut y consacrer jusqu'à 90 % de l'or ;
  - une pierre absente de la boutique mais trouvable en explorant (lootPool) emmène le bot dans la zone qui la donne.

## [1.7.7]

### Corrigé

- Centre : le bot échangeait sans fin deux Pokémon (signalé à la Caverne Azurée : Leveinard ↔ Grolem, puis Leveinard ↔ Ronflex). Deux calculs dépendaient de l'équipe du moment :
  - la préparation du boss (Mewtwo) ne se déclenchait que si l'équipe **actuelle** n'était pas prête. Leveinard dedans : équipe prête, équipe XP, Leveinard sort ; plus prête, préparation, Leveinard revient… Désormais, tant que le boss de la zone attend, l'équipe se compose contre lui ;
  - seuls les meilleurs niveaux **de la Boîte** étaient évalués : un Pokémon renvoyé en Boîte pouvait sortir de cette liste, puis y revenir. Les candidats sont maintenant les meilleurs niveaux de l'équipe et de la Boîte réunies.
- Garde-fous en plus, contre toute autre boucle d'échange :
  - avant un combat, au plus 2 changements de meneur par rencontre, et jamais pour remettre un Pokémon qu'on vient de remplacer ;
  - au Centre, un Pokémon mis en Boîte depuis moins de 10 minutes ne revient pas, et au plus 3 échanges par passage.
  Chaque garde-fou écrit une ligne « ⛔ … boucle évitée » dans le journal.

## [1.7.6]

### Corrigé

- Boutique : en fin de partie, le bot revendait ses Hyper Potions puis les rachetait, à chaque passage. La règle « soins devenus trop faibles » (moins de 20 % des PV max de l'équipe) visait l'Hyper Potion face à des Pokémon N.100, alors qu'elle restait le meilleur soin en vente : revendue à moitié prix, rachetée au prix fort. Un soin n'est plus considéré dépassé que s'il est plus faible que le palier acheté, et rien de ce que la boutique veut acheter n'est revendu.

## [1.7.5]

### Corrigé

- Capture : le bot restait bloqué sur « Presque ! Lancer un Appât pour attirer … ? » (et sur « … est toujours là ! », bouton Relancer). Il n'entrait dans la capture que s'il voyait LANCER POUR CAPTURER ou l'astuce de capture, absents de ces écrans. L'appât est lancé pour une nouvelle espèce, un chromatique, un légendaire ou un raid, gardé sinon.
- Soins : potion utilisée alors que l'attaque tuait l'adversaire. Si le jeu n'affichait pas les dégâts du lancer, le bot considérait qu'on ne tuait pas. Il les calcule maintenant lui-même, et joue d'abord les relances prévues avant d'envisager un soin.

### Modifié

- Raids : plus aucun objet (soins, remèdes, Huiles) pendant un raid par défaut (`raidItems: false`). Les Pokémon du raid sont des copies qui ne perdent aucun vrai PV, alors que chaque potion est une vraie dépense. L'équipe reste choisie sur les dégâts infligés avant K.O., survie comprise.

## [1.7.4]

### Corrigé

- **Capture : les options de Ball n'étaient presque jamais reconnues.** Le libellé du jeu est « {label}{left} : {pct} % de chance{useless} », et `{useless}` n'est rempli que pour une Ball inutile (« , inutile »). Le bot exigeait au moins un caractère pour chaque paramètre (`Rt.re`) : seules les Balls inutiles étaient reconnues. Capture difficile : aucune option vue, le jeu lançait sa sélection par défaut (« Sans Ball »). Capture facile : des Hyper Balls gaspillées. Un paramètre peut maintenant être vide.
- Raids : bloqué sur « Retour / Réessayer » (et sur « capturé ! »). La section du combat reste affichée sous le résultat, et le bot croyait le combat toujours en cours. Les résultats sont maintenant traités avant l'attente du combat.
- Raids : blocage au changement de tour. Le bot pouvait demander un changement de Pokémon (règle des dresseurs), qui coûte le tour en raid et ouvre une fenêtre propre au raid. Plus aucun changement volontaire en raid ; une fenêtre « changer » ou « abandonner » restée ouverte est refermée (« Continuer »).
- Raids : le boss recevait une Ball ordinaire si le raid n'avait pas été noté avant la capture (espèce déjà vue → Ball la moins chère). Une capture en raid prend maintenant toujours la meilleure chance, Master Ball comprise. Le boss est aussi reconnu par le texte « {boss} est épuisé ! Lance une Ball ! ».

## [1.7.3]

### Corrigé

- Raids : le bot choisissait deux Pokémon puis effaçait l'équipe, en boucle. Pour lire l'ordre des Pokémon choisis, il cherchait le numéro de place avec `span:last-child`, qui attrapait d'abord une case vide du sprite. L'ordre lu était toujours faux. Le numéro est maintenant lu dans `span.light-scope`, et l'équipe de départ n'est effacée qu'une seule fois.
- Raids : un raid légendaire marqué fait par le jeu (`events.raidsDone`, clé « zone:dex ») n'est plus proposé.

### Ajouté

- Raids : choix du raid à lancer dans l'onglet Versus & Raids (`raidTarget`) : « Automatique » (raid du jour d'abord, puis les raids légendaires) ou un raid précis parmi ceux qui sont ouverts.
- Raids : mode en boucle (`raidLoop`) : aucun plafond d'essais par jour ni arrêt sur estimation défavorable.
- Raids : seulement les espèces pas encore au Pokédex (`raidOnlyMissing`, activé par défaut). Le raid du jour d'une espèce déjà capturée est passé ; les raids légendaires l'étaient déjà.

## [1.7.2]

### Corrigé

- Capture : une nouvelle espèce pouvait recevoir une Ball faible, voire « Sans Ball ». Le bot décidait « nouvelle espèce » sur la carte de rencontre ; quand l'espèce n'y était pas lisible, il la traitait comme déjà capturée. Il lit maintenant l'espèce sur l'écran de capture (« Le Pikachu est épuisé ! ») et la compare au Pokédex.
- Capture : les Balls sont reconnues par leur nom traduit **et** par leur nom dans les données du jeu. Sans ça, prix et bonus valaient 0 et la Master Ball n'était plus protégée.
- Raids : le bot ne composait jamais l'équipe. Pour la remettre dans l'ordre, il la vidait ; le jeu désactive alors « Enregistrer », le bot ne reconnaissait plus la fenêtre et recliquait sur « Modifier » en boucle. La fenêtre est maintenant reconnue même quand « Enregistrer » est désactivé ; l'équipe est vidée d'un coup (« Effacer ») puis refaite dans l'ordre.
- Raids : chaque Pokémon de la liste est identifié par son nom et son niveau. Le numéro de place affiché quand il est choisi changeait sa clé et empêchait de le retrouver.
- Raids : le boss du raid du jour est lu dans la note « Recommandé : … contre {name} » de la fenêtre d'équipe, avant de chercher un nom dans la page.

### Modifié

- Capture : une nouvelle espèce reçoit toujours la Ball qui donne la meilleure chance, même si c'est une Hyper Ball (`catchNewPct` passe de 80 à 100). La Master Ball reste réservée aux légendaires. Le journal liste toutes les options et leur chance.
- Mode « Pokédex : captures » : le bot ne fait évoluer un Pokémon (élève au Centre ou objet d'évolution) que si son **évolution directe** manque au Pokédex et n'apparaît pas en sauvage à au moins `dexCatchInsteadPct` % (5 %) d'une zone ouverte. Sinon, elle se capture. Faire monter un Pokémon dont l'évolution est déjà recensée ne sert à rien : Minidraco → Draco (déjà vu) n'est plus entraîné, même si Dracolosse manque. Les places sans élève utile vont aux Pokémon les plus forts.

## [1.7.1]

### Modifié

- Capture : la règle du seuil de 80 % (v1.6.1) ne s'applique plus qu'aux espèces absentes du Pokédex. Une espèce déjà capturée reçoit de nouveau la Ball la moins chère (`catchKnown: 'cheap'`, le défaut d'avant la v1.6.1). La règle du seuil reste disponible pour elles dans le panneau.

## [1.7.0]

### Ajouté

- XP « porteur + élèves » (`xpTrainees`) : le jeu donne 30 % de l'XP, plus 5 % par niveau d'écart, aux membres de l'équipe qui ne combattent pas (Multi Exp, port de `CJ`), soit 100 % à partir de 14 niveaux d'écart. Au Centre, le meilleur duel porte l'équipe (deux porteurs si son duel reste sous `carrierSafeScore`) et les autres places vont à des élèves. Priorité des élèves : évolution qui manque au Pokédex, Versus (N.50), contre d'un raid perdu, meilleur potentiel au niveau max. Pas pendant la préparation d'un boss.
- Meneur choisi pour l'XP utile (`xpLead`) : parmi les duels sans risque, celui qui fait gagner le plus d'XP à l'équipe. L'XP d'un Pokémon au niveau max compte pour zéro.
- Mode Farm : objectif « XP (zone la plus rentable sans risque) » (`farmGoal: 'xpAuto'`). XP par rencontre = niveau adverse moyen × multiplicateurs, divisée par 2 dans une zone terminée.
- Journal : avertissement si l'option Multi Exp est coupée dans les réglages du jeu.

### Modifié

- Mode Farm : « le moins haut niveau mène » (`trainWeakest`) n'est plus actif par défaut. Avec Multi Exp, il faisait combattre le plus faible pendant que les Pokémon au niveau max derrière lui ne gagnaient rien. L'option reste disponible.
- Mode Pokédex : les espèces déjà capturées ne sont plus fuies tant qu'un élève est dans l'équipe : un combat rapide du porteur, c'est de l'XP gratuite.

## [1.6.1]

### Corrigé

- Capture : une espèce déjà au Pokédex recevait toujours la Ball la moins chère, même à 33 % de chance. Nouvelle règle du seuil (80 % par défaut, `catchKnown: 'normal'`) : si même la meilleure Ball reste sous le seuil, on lance la meilleure ; sinon la moins chère qui le dépasse. Même règle pour une nouvelle espèce (`catchNewPct` passe de 100 à 80 %). Chromatiques, légendaires et raids gardent la meilleure chance.
- Améliorations de combos : le bot ne comptait que les lancers où un combo était déjà le mieux payé. Les combos faciles mais souvent dépassés (la Paire derrière une Double paire, par exemple) semblaient inutiles et n'étaient presque jamais achetés. Il mesure maintenant le gain réel du combo payé après amélioration, avec les relances jouées pour former un combo et les Pokémon de la Boîte (poids `upgradeBoxWeight`, comme pour les dés).

## [1.6.0]

### Ajouté

- Capture : l'amélioration « Chance de capture » (seconde chance quand la Ball rate) est achetée d'office en mode Pokédex : captures (`pokedexLuck`).
- Capture : achat d'appâts (`buy.bait`, `stock.bait`), lancés quand une Ball rate de peu. Ignorés si le jeu a coupé l'objet (`itemSwitches`).
- Capture : espèce visée (`catchTarget`). Le bot va dans la zone ouverte où elle apparaît le plus, puis l'objectif s'efface une fois l'espèce au Pokédex.
- Mode Pokédex : les fossiles d'espèces manquantes sont achetés en boutique (`buy.fossil`) ou cherchés dans la zone qui les donne.
- Raids : ajout d'amis au groupe (`raidFriends`), choisis sur le nombre de Pokémon recommandés par le jeu.
- Raids : estimation des chances (dégâts du groupe / PV totaux du boss). Sous `raidMinOdds`, le bot arrête après 2 défaites et entraîne au Centre le meilleur « contre » pas encore au niveau plafond (`raidTrain`).
- Routines tous modes : tour gratuit de la Roue de la fortune (`eventWheel`), Pension (`dayCare` : éclosion des Œufs, dépôt d'un couple compatible), Revanche du Conseil 4 (`rebattle`, désactivée par défaut).
- Notifications du navigateur et petit son (`notify`, `notifySound`) : chromatique, légendaire, boss battu, raid réussi, Œuf chromatique, objectif atteint, bot arrêté.
- Planning par plages horaires (`schedule`).
- Anti-veille (`keepAwake`, activé par défaut) : verrou d'écran du navigateur (Wake Lock) tant que le bot tourne et que l'onglet est visible. Le PC ne se met plus en veille pendant une session.
- Statistiques de session dans l'onglet Bilan (clé `pokebot.stats`) : captures, chromatiques, réussite de chaque Ball, raids, Œufs, roue.
- Groupes Œuf lus dans le bundle du jeu (ils ne sont pas dans IndexedDB).

### Corrigé

- Raids : la capture (« {name} est capturé ! ») et la fuite du boss n'étaient jamais détectées, car le libellé commence par un paramètre. Nouveau test ligne par ligne (`lineHas`).

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
