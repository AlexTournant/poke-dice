# Installation et mises à jour automatiques

Le script se met à jour tout seul dans Tampermonkey : son en-tête indique où chercher la dernière version.

```js
// @updateURL    https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js
```

Tampermonkey télécharge régulièrement ce fichier, compare son `@version` à celle installée et installe la nouvelle version si elle est plus grande. Seule la branche `main` est suivie : une modification n'arrive chez les joueurs qu'une fois fusionnée (CI verte).

## 1. Installer le script depuis l'URL

C'est la méthode à privilégier : le script est alors relié à son URL de mise à jour.

1. Installer l'extension [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox…).
2. Ouvrir dans le navigateur :
   https://raw.githubusercontent.com/AlexTournant/poke-dice/main/pokedice-bot.user.js
3. Tampermonkey intercepte le fichier `.user.js` et affiche sa page d'installation. Cliquer sur **Installer**.
4. Ouvrir https://poke-dice.netlify.app/ : la barre du bot apparaît en haut à gauche.

> Si le navigateur affiche le code brut au lieu de la page d'installation, vérifier que Tampermonkey est activé, puis recharger la page.

## 2. Vous aviez déjà collé le script à la main

Une copie collée ne connaît pas l'URL de mise à jour. Il suffit de faire une fois l'étape 1 : Tampermonkey reconnaît le script (même `@name` et `@namespace`) et propose de le **mettre à jour** au lieu d'en créer un second.

Les réglages du bot (mode, verrou, options du panneau ⚙️) sont stockés dans le `localStorage` du jeu : ils sont conservés.

Vérifier ensuite dans le tableau de bord Tampermonkey qu'il n'existe qu'un seul « Pokédice Autopilot ». S'il y en a deux, supprimer l'ancien.

## 3. Vérifier que la mise à jour est active

Dans le tableau de bord Tampermonkey, ouvrir **Pokédice Autopilot**, onglet **Paramètres** :

- **Vérifier les mises à jour** (*Check for updates*) doit être coché ;
- **URL de mise à jour** (*Update URL*) doit contenir l'adresse `raw.githubusercontent.com/…/main/pokedice-bot.user.js`.

Modifier le script dans l'éditeur de Tampermonkey le rend « local » : une mise à jour écraserait vos modifications. Pour changer le bot, passer par le dépôt (voir [CONTRIBUTING.md](CONTRIBUTING.md)).

## 4. Fréquence de vérification

Tableau de bord Tampermonkey → **Paramètres** → section **Mises à jour des scripts** (*Script Update*) :

- **Intervalle de vérification** (*Check Interval*) : « Chaque jour » par défaut. « Toutes les 6 heures » convient si l'on veut les correctifs plus vite.

Si la section n'apparaît pas, passer **Mode de configuration** (*Config mode*, en haut des paramètres) sur **Avancé**.

## 5. Forcer une mise à jour tout de suite

- Menu de l'extension Tampermonkey → **Rechercher des mises à jour des scripts** (*Check for userscript updates*) ;
- ou, dans le tableau de bord, cliquer sur la date de la colonne **Dernière mise à jour** du script.

Recharger ensuite l'onglet du jeu pour que la nouvelle version s'exécute.

La version installée s'affiche dans le tableau de bord Tampermonkey (colonne *Version*) ; elle doit correspondre à la dernière section de [CHANGELOG.md](CHANGELOG.md).

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Aucune mise à jour proposée | `@version` n'a pas augmenté (Tampermonkey ignore une version identique ou inférieure), ou le changement n'est pas encore fusionné sur `main`. |
| Mise à jour visible sur GitHub mais pas dans Tampermonkey | GitHub met en cache les fichiers *raw* quelques minutes : réessayer un peu plus tard. |
| Erreur 404 lors de la vérification | Le dépôt doit être **public** : un dépôt privé n'est pas accessible par `raw.githubusercontent.com` sans jeton. |
| Deux scripts « Pokédice Autopilot » | Un ancien script a un `@namespace` différent : supprimer l'ancien. |

## Pour les mainteneurs

- Toute modification du script incrémente `@version` (la CI le vérifie) : sans cela, personne ne reçoit la mise à jour.
- Ne pas changer `@name` ni `@namespace` : Tampermonkey identifie le script par ce couple, et les joueurs se retrouveraient avec deux scripts.
- Ne pas changer `@updateURL` / `@downloadURL` sans raison : une URL qui ne répond plus coupe les mises à jour de tous les joueurs, sans retour possible autre qu'une réinstallation manuelle.
