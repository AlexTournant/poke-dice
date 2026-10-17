#!/usr/bin/env node
// Contrôles de version et notes de release pour pokedice-bot.user.js. Aucune dépendance.
//
//   node scripts/check-version.js --base <ref>     PR : si le script change, @version doit augmenter
//                                                  et CHANGELOG.md doit contenir sa section
//   node scripts/check-version.js --tag <vX.Y.Z>   release : le tag doit correspondre à @version,
//                                                  être posé sur main, et avoir sa section CHANGELOG
//   node scripts/check-version.js --notes <vX.Y.Z> affiche les notes de la section (corps de la release)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = 'pokedice-bot.user.js';
const CHANGELOG = 'CHANGELOG.md';
const SEMVER = /^\d+\.\d+\.\d+$/;
const USAGE = 'usage : check-version.js --base <ref> | --tag <vX.Y.Z> | --notes <vX.Y.Z>';

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
const ok = (msg) => console.log(`✔ ${msg}`);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Contenu du script : dans l'arbre de travail, ou tel qu'il est sur une référence git. */
function readScript(ref) {
  return ref ? git('show', `${ref}:${SCRIPT}`) : fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');
}

/** Lit `// @version X.Y.Z` dans l'en-tête du script. */
function versionOf(source) {
  const m = source.match(/^\/\/\s*@version\s+(\S+)\s*$/m);
  return m ? m[1] : null;
}

/** Positif si a > b (comparaison composante par composante de X.Y.Z). */
function compareSemver(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Corps de la section `## [version]` de CHANGELOG.md, ou null si elle n'existe pas. */
function changelogSection(version) {
  const lines = fs.readFileSync(path.join(ROOT, CHANGELOG), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
  return lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();
}

function tagVersion(tag) {
  const m = tag.match(/^v(\d+\.\d+\.\d+)$/);
  if (!m) fail(`tag « ${tag} » invalide (attendu vX.Y.Z)`);
  return m[1];
}

function checkBase(base) {
  const current = versionOf(readScript());
  if (!current || !SEMVER.test(current)) {
    fail(`@version absente ou invalide dans ${SCRIPT} (attendu X.Y.Z, trouvé « ${current} »)`);
  }

  let changed;
  try {
    changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  } catch (e) {
    fail(`impossible de comparer avec ${base} (checkout avec fetch-depth: 0 ?) : ${String(e.stderr || e.message).trim()}`);
  }
  if (!changed.includes(SCRIPT)) {
    ok(`${SCRIPT} non modifié : pas de nouvelle version requise (${current})`);
    return;
  }

  let previous = null;
  try {
    previous = versionOf(readScript(base));
  } catch {
    // script absent sur la branche cible : c'est la première version
  }
  if (!previous) ok(`${SCRIPT} : première version (${current})`);
  else if (compareSemver(current, previous) <= 0) {
    fail(`${SCRIPT} a changé mais @version ${current} n'est pas supérieure à celle de ${base} (${previous}) : incrémente-la`);
  } else ok(`@version ${previous} → ${current}`);

  if (!changelogSection(current)) fail(`${CHANGELOG} : pas de section « ## [${current}] » pour cette version`);
  ok(`${CHANGELOG} : section ${current} présente`);
}

function checkTag(tag) {
  const version = tagVersion(tag);
  const current = versionOf(readScript());
  if (current !== version) fail(`le tag ${tag} ne correspond pas à @version ${current} dans ${SCRIPT}`);
  ok(`tag ${tag} = @version ${current}`);

  try {
    git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
  } catch {
    fail(`le tag ${tag} doit pointer sur un commit de main (origin/main)`);
  }
  ok('commit présent sur main');

  if (!changelogSection(version)) fail(`pas de section « ## [${version}] » dans ${CHANGELOG}`);
  ok(`${CHANGELOG} : section ${version} présente`);
}

function printNotes(tag) {
  const version = tagVersion(tag);
  const section = changelogSection(version);
  if (section == null) fail(`pas de section « ## [${version}] » dans ${CHANGELOG}`);
  if (!section) fail(`la section ${version} de ${CHANGELOG} est vide`);
  process.stdout.write(`${section}\n`);
}

const [flag, arg] = process.argv.slice(2);
if (!arg) fail(USAGE);
switch (flag) {
  case '--base': checkBase(arg); break;
  case '--tag': checkTag(arg); break;
  case '--notes': printNotes(arg); break;
  default: fail(USAGE);
}
