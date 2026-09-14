# Vérification manuelle — documentation intégrée et mode tutoriel

**Date** : 2026-09-14
**Branche** : `claude/aide-integree`
**Méthode** : pile lancée localement (backend `:8000`, frontend `:5173`), pilotage
navigateur réel via Chrome DevTools. Base SQLite neuve, donc **sans aucune
compétition importée** — ce qui exerce précisément le filtrage des étapes dont
l'ancre est absente du DOM.

## Résumé

Tout le parcours fonctionne. **Un défaut a été trouvé et corrigé** pendant la
vérification (bulle tronquée hors écran, commit `814103d`) ; tout le reste est
conforme du premier coup.

## Parcours club (compte `admin`)

| # | Point vérifié | Résultat |
|---|---|---|
| 1 | Modal d'invite à la première connexion | ✅ « Découvrir l'application », dialogue focalisé |
| 2 | « Plus tard » ferme, bouton « Tutoriel » visible dans la barre | ✅ |
| 3 | Démarrage : bandeau sous la barre, en flux (ne recouvre rien) | ✅ « Terminer le tutoriel » bien visible |
| 4 | Première étape : surlignage de la sidebar | ✅ après correction (voir défaut ci-dessous) |
| 5 | Compteur cohérent | ✅ **1/7** — 8 étapes déclarées moins celles sans ancre |
| 6 | Enchaînement Suivant jusqu'à la fin | ✅ 7 étapes, titres distincts, bulle toujours dans l'écran |
| 7 | « Terminer cet écran » ferme l'overlay | ✅ |
| 8 | Pastille de rappel après un écran épuisé | ✅ « Tutoriel actif » + « Revoir le tableau de bord » |
| 9 | Navigation vers Patineurs déclenche l'overlay de CET écran | ✅ « Les patineurs du club », 1/1 |
| 10 | Retour sur un écran déjà vu ne redéclenche rien | ✅ `["/","/patineurs"]` mémorisés, aucun overlay |
| 11 | « Revoir cet écran » rejoue le mini-parcours | ✅ retour à 1/7 |
| 12 | Persistance du mode au rechargement de page | ✅ bandeau conservé, `sessionStorage` intact |
| 13 | « Terminer le tutoriel » | ✅ bandeau, pastille, overlay et bouton disparaissent |
| 14 | Persistance en base | ✅ `tutorial_seen: true` renvoyé par `/api/auth/login` |

## Parcours patineur (compte `skater`)

| # | Point vérifié | Résultat |
|---|---|---|
| 1 | Redirection vers la page du patineur | ✅ `/patineurs/1/analyse` |
| 2 | Modal d'invite sur SA page d'entrée (il n'atteint jamais `/`) | ✅ |
| 3 | Repères du shell adaptés | ✅ 1re étape « **Votre espace** », pas « Le menu de navigation » |
| 4 | Étapes filtrées par parcours et par données | ✅ 5 étapes (évolution/éléments absents : aucune compétition) |
| 5 | Chapitres du menu « ? » | ✅ **4 chapitres** — Bienvenue, La page de mon patineur, Comprendre les scores, Mon compte. Aucune fuite d'import ni d'administration |
| 6 | Tutoriel non terminé ⇒ non persisté | ✅ `tutorial_seen: false` |

## Documentation

- Panneau latéral : ✅ ouvre le bon chapitre depuis le menu « ? ».
- Illustrations JSX : ✅ tableau de scores fictif (2A / 3T / FCSp3), GOE coloré
  (positif en `primary`, négatif en `error`), chiffres en `font-mono`.
  **Aucune donnée de patineur réel.**
- Accessibilité : ✅ `aria-label="Documentation : Comprendre les scores"`,
  illustration en `aria-hidden="true"`, légende textuelle porteuse du sens.

## Responsive (454 × 654)

- Bandeau réduit à « Mode tutoriel », bouton « Terminer le tutoriel » conservé : ✅
- Les **7 étapes** entièrement dans le viewport (vérifié par mesure de
  `getBoundingClientRect` sur chacune) : ✅
- Pastille de rappel lisible, ne masque rien d'essentiel : ✅

## Défaut trouvé et corrigé

**Bulle du tutoriel tronquée hors écran** (commit correctif `814103d`).

Mesure initiale sur la 1re étape : `top = -131px` — titre et corps invisibles,
seuls le compteur et « Suivant » restaient lisibles.

*Cause* : défaut des mathématiques du plan, fidèlement transcrites. La cible
(sidebar) mesure 490 px ; l'espace sous elle (165 px) passe sous le seuil de
220 px, donc la bulle bascule au-dessus via
`bottom = innerHeight - target.top + GAP`. La cible commençant à y=72, la bulle
sortait par le haut. La position horizontale était bornée au viewport, la
verticale ne l'était pas.

*Correction* : hauteur de bulle mesurée et position verticale bornée à
`[GAP, innerHeight - hauteur - GAP]`. Quand ni au-dessus ni en dessous ne tient
(cible très haute), la bulle chevauche la cible plutôt que de sortir de l'écran.

*Après correction* : `top = 72`, entièrement visible ; les 7 étapes du parcours
club et les 5 du parcours patineur sont dans le viewport, en 1440 px comme en
454 px de large.

Ce défaut avait été signalé en « Minor » lors de la revue des tâches 7-10 et
différé à cette vérification. Constaté en conditions réelles, il rendait la
première étape du tutoriel illisible : requalifié Important et corrigé.

## Tests backend

`509 passed` (base de référence avant la fonctionnalité : 505 ; +4 tests ajoutés).

## Réserve

La vérification a été menée sur une base **sans compétition importée**. Le
filtrage par absence d'ancre est donc bien exercé, mais les étapes qui décrivent
des blocs riches en données (évolution des scores, détail des éléments, liste
des compétitions) n'ont pas pu être vues avec des données réelles. Elles sont
déclarées au registre et leurs ancres sont posées ; leur rendu avec données
reste à confirmer lors du premier usage réel.
