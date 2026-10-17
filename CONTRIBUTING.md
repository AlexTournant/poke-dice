# Contribuer et publier une version

## Flux de travail

`main` est protégée : on n'y pousse jamais directement. Tout passe par une pull request.

1. Créer une branche depuis `main` : `git switch -c fix/mon-correctif`.
2. Modifier le code et lancer `npm test`.
3. Si `pokedice-bot.user.js` change :
   - incrémenter `@version` (SemVer : `X.Y.Z` → correctif `Z`, fonctionnalité compatible `Y`, changement incompatible `X`, par exemple un réglage renommé) ;
   - ajouter une section `## [X.Y.Z]` dans `CHANGELOG.md`.
4. Ouvrir une pull request vers `main`. Le check **CI** doit passer (tests, syntaxe, version). Sans lui, le bouton de fusion reste bloqué.
5. Fusionner. Une fusion ne publie rien : la publication se fait par tag (ci-dessous).

## Publier une release

Depuis `main` à jour :

```bash
git switch main
git pull
git tag -a v1.4.1 -m "v1.4.1"
git push origin v1.4.1
```

Le workflow **Release** s'exécute alors :

1. relance les tests ;
2. vérifie que le tag correspond à `@version` ;
3. vérifie que le commit est sur `main` ;
4. vérifie que `CHANGELOG.md` a la section de la version ;
5. crée la release GitHub avec `pokedice-bot.user.js` en pièce jointe et les notes extraites du CHANGELOG.

Si une étape échoue, rien n'est publié : corriger, puis supprimer le tag (`git push --delete origin v1.4.1`, `git tag -d v1.4.1`) avant de le recréer.

Lien stable pour installer la dernière version publiée :
https://github.com/AlexTournant/poke-dice/releases/latest/download/pokedice-bot.user.js

## Mise en place sur GitHub (une seule fois)

Ces protections ne sont pas dans les fichiers du dépôt : elles se règlent sur GitHub. Le check **CI** n'apparaît dans la liste des checks obligatoires qu'après sa première exécution, c'est-à-dire après avoir poussé ces fichiers et ouvert une PR.

### Protéger `main`

Dans **Settings → Rules → Rulesets** (ou **Settings → Branches**), pour la branche `main` :

- Require a pull request before merging
- Require status checks to pass → ajouter le check **CI**, cocher *Require branches to be up to date*
- Block force pushes, Restrict deletions
- Ne pas autoriser le contournement par les administrateurs

Équivalent en ligne de commande (`gh` authentifié) :

```bash
gh api -X PUT repos/AlexTournant/poke-dice/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["CI"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
EOF
```

`required_approving_review_count: 0` impose la pull request sans exiger une relecture, ce qui convient à un projet à une personne. Mettre `1` le jour où quelqu'un relit.

### Protéger les tags de version (recommandé)

Dans **Settings → Rules → Rulesets**, nouveau ruleset de type *Tag* sur le motif `v*` : bloquer la suppression et la modification. Ainsi une version publiée ne peut pas être réécrite.

## Ce que la CI ne couvre pas

- Le script n'est pas exécuté dans un vrai navigateur ni sur le site du jeu : les tests passent par un faux DOM (`test/dom-stub.js`). Une régression visuelle ou une évolution de Pokédice reste à vérifier à la main.
- Les formules de dégâts sont validées contre des cas relevés en jeu (`pokedice-bot.test.js`), pas contre le jeu en direct.
