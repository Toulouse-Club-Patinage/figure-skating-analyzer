# Documentation intégrée et tutoriel interactif

**Date** : 2026-09-13
**Statut** : validé, prêt pour le plan d'implémentation

## Objectif

Donner à l'utilisateur les moyens de comprendre l'application sans quitter
l'application : un menu « ? » dans la barre supérieure ouvrant une
documentation illustrée, et un tutoriel en superposition qui situe les repères
de l'interface. Le tutoriel est proposé à la première connexion, après le
modal de changement de mot de passe, et reste accessible ensuite.

## Décisions structurantes

| Question | Décision |
|---|---|
| Nature des captures | Illustrations recomposées en JSX, données fictives — pas de captures PNG |
| Portée par rôle | Deux parcours : « club » (admin/coach/reader) et « patineur » (skater) |
| Persistance du « déjà vu » | Colonne `users.tutorial_seen_at`, via `PATCH /api/me/preferences` |
| Étendue du tour | Une seule page, avec renvois vers les chapitres de la doc |
| Ancrage des étapes | Attributs `data-tour` explicites, étape sautée si la cible est absente |
| Séquence d'accueil | Invite dès la fermeture du modal mot de passe, quelle qu'en soit l'issue |
| Comptes existants | Voient l'invite — pas de backfill de `tutorial_seen_at` |

### Pourquoi des illustrations JSX plutôt que des captures

Trois raisons : aucune donnée personnelle de patineur ne se retrouve dans la
documentation ; les illustrations suivent le design system et ne périment pas
au premier ajustement de l'UI ; elles restent lisibles en responsive là où une
capture de tableau large ne l'est pas.

### Pourquoi un tour sur une seule page

Un tour multi-pages devrait orchestrer la navigation, attendre le chargement
des données, et gérer les états vides d'une installation neuve. Le tour situe
les repères du shell — ce qu'il fait de façon fiable — et délègue
l'explication en profondeur à la documentation, vers laquelle chaque étape
renvoie.

## Architecture

### Approche retenue : un contexte `HelpProvider` unique

Un contexte React possède tout l'état de la fonctionnalité — panneau de doc
ouvert et sur quel chapitre, tour actif et à quelle étape, invite due — et
l'expose aux composants visuels. Le renvoi d'une étape du tour vers un
chapitre est alors un appel direct, sans couplage entre composants ni passage
par l'URL.

Deux alternatives écartées : l'état local dans `AuthenticatedLayout` (qui
alourdirait un `App.tsx` déjà à 464 lignes et mêlant nav, routes et layout) et
la documentation comme page routée `/aide` (qui rendrait le chapitre
partageable, mais ferait quitter sa page à l'utilisateur et démonterait le
tour au moment du renvoi).

### Fichiers

```
frontend/src/help/
  HelpContext.tsx      État partagé + orchestration de la séquence d'accueil
  HelpMenu.tsx         Le bouton « ? » et son menu, à côté de la cloche
  DocPanel.tsx         Panneau latéral de documentation (sommaire + chapitre)
  TourOverlay.tsx      Superposition du tour : masque, surlignage, bulle
  TourInviteModal.tsx  Modal « Découvrir l'application ? » (1re connexion)
  StartTourButton.tsx  Bouton visible tant que le tour n'a pas été suivi
  content.tsx          Chapitres de doc + illustrations JSX (données)
  tour.ts              Définition des étapes
```

### Montage dans le shell

`HelpProvider` enveloppe le contenu de `AuthenticatedLayout`, à l'intérieur de
`JobProvider`. La barre supérieure (`App.tsx:409`) reçoit `<StartTourButton />`
et `<HelpMenu />` juste avant `<NotificationBell />`. Les couches flottantes
(`DocPanel`, `TourOverlay`, `TourInviteModal`) sont rendues en fin de layout,
à côté de `ForcePasswordModal`.

### Interface du contexte

```ts
{
  openDoc(chapterId?: string): void
  closeDoc(): void
  startTour(): void
  stopTour(): void              // marque le tutoriel comme vu
  tourActive: boolean
  tourSeen: boolean             // depuis user.tutorial_seen
  audience: "club" | "skater"   // role === "skater" ? "skater" : "club"
}
```

`audience` est calculé une seule fois ici et sert à filtrer chapitres et
étapes : la règle des deux parcours ne vit qu'à un seul endroit.

### Empilement (z-index)

L'existant : sidebar `z-40`, barre supérieure `z-30`, modals `z-50`. Le tour
doit surligner la sidebar et la barre, donc passer au-dessus de `z-40`.

| Couche | z-index |
|---|---|
| `TourOverlay` | `z-[60]` |
| `DocPanel` | `z-50` |
| `TourInviteModal` | `z-50` |
| `ForcePasswordModal` (existant) | `z-50` |

`TourInviteModal` et `ForcePasswordModal` ne sont jamais simultanés par
construction (voir « Séquence d'accueil »).

## Le menu « ? » et la documentation

### Le bouton et son menu

Le bouton reprend la facture de la cloche : `material-symbols-outlined`
(`help`), couleur `on-surface-variant`, même hover. Le menu déroulant reprend
la largeur et le style du panneau de notifications (`w-80`, `rounded-xl`,
`shadow-lg`), avec le pattern `useRef` + écouteur `mousedown` de
`NotificationBell` pour la fermeture au clic extérieur.

Contenu du menu : **Démarrer le tutoriel** (icône `play_circle`), un séparateur
par changement de surface — pas de bordure, conformément au design system —
puis la liste des chapitres du parcours de l'utilisateur.

### Le panneau

Glisse depuis la droite : `fixed right-0 top-0 h-screen w-full max-w-xl`,
surface `surface-container-lowest`, backdrop `bg-scrim/50`. Pleine largeur sur
mobile. En-tête (titre + fermer), corps du chapitre, pied de navigation
« chapitre précédent / suivant » pour une lecture linéaire.

### Structure d'un chapitre

```ts
type Chapter = {
  id: string
  title: string
  icon: string                      // Material Symbols
  audience: ("club" | "skater")[]
  adminOnly?: boolean               // affiche un badge « Administrateur »
  body: () => ReactNode
}
```

### Chapitres

**Parcours club** : Premiers pas · Le tableau de bord · Les patineurs et leur
analyse · Les compétitions et l'import *(badge admin)* · Les statistiques du
club · Le constructeur de programme · Le suivi d'entraînement ·
Administration *(admin)*.

**Parcours patineur/parent** : Bienvenue · La page de mon patineur ·
Comprendre les scores (éléments, GOE, PCS) · Mon compte et mes patineurs.

### Illustrations

Composants JSX dans `content.tsx`, construits avec les classes Tailwind du
design system et des données fictives (« Camille Dupont », scores
plausibles) : mini-sidebar, extrait de tableau de scores, carte de patineur.
Chaque illustration est décorative — conteneur `aria-hidden`, légende
textuelle portant l'information réelle — pour que la documentation reste
compréhensible sans elles.

## Le tutoriel interactif

### Surlignage

À chaque étape, `TourOverlay` résout `[data-tour="<id>"]`, lit son
`getBoundingClientRect()` et rend :

- un masque en **quatre rectangles** `bg-scrim/60` autour de la cible — plus
  fiable à positionner qu'un `box-shadow` géant, et laisse la cible cliquable ;
- un anneau `ring-2 ring-primary rounded-xl` sur la cible, avec un léger halo ;
- une **bulle** au-dessus ou en dessous selon la place disponible : titre,
  deux ou trois phrases, compteur « 3 / 7 », *Précédent* / *Suivant* (ou
  *Terminer*), lien discret *Passer le tutoriel*, et *En savoir plus →* quand
  l'étape porte un `chapterId`.

Le rectangle est recalculé sur `resize` et `scroll` (écouteurs passifs,
nettoyés au démontage). Avant mesure, l'étape fait défiler la cible dans la
vue via `scrollIntoView({ block: "center" })`.

### Définition d'une étape

```ts
type TourStep = {
  target: string            // valeur de data-tour
  title: string
  body: string
  chapterId?: string        // « En savoir plus »
  audience: ("club" | "skater")[]
}
```

### Filtrage

À l'ouverture : d'abord par `audience`, puis élimination des étapes dont la
cible est absente du DOM. Ce second filtre absorbe les différences de rôle
— pas de lien *Administration* pour un `coach`, pas d'*Entraînement* si
`training_enabled` est faux — sans dupliquer aucune liste de rôles. Si la
liste filtrée est vide, le tour ne démarre pas et le signale.

### Points d'ancrage

Huit attributs `data-tour`, tous dans `App.tsx` : `sidebar-nav`,
`nav-patineurs`, `nav-competitions`, `nav-club`, `topbar-title`,
`notifications`, `help-menu`, `user-account`. Aucune autre page n'est
modifiée.

### Sortie

*Terminer*, *Passer*, la croix, `Échap`, ou un clic sur le masque : les cinq
passent par `stopTour()`, qui persiste le « vu ». Le focus est piégé dans la
bulle pendant le tour, puis rendu au bouton d'origine.

### Le bouton de démarrage

`StartTourButton` s'affiche dans la barre supérieure tant que `tourSeen` est
faux : `bg-primary text-on-primary rounded-xl`, icône `play_circle` + libellé
« Tutoriel » (icône seule sous `sm`). Après le premier tour, il disparaît — le
tutoriel reste accessible depuis le menu « ? ».

## Persistance et séquence d'accueil

### Backend

Colonne sur `User` :

```python
tutorial_seen_at: Mapped[datetime | None] = mapped_column(
    DateTime, nullable=True, default=None
)
```

Déclarée dans `_MIGRATIONS` de `backend/app/database.py` :
`("users", "tutorial_seen_at", "DATETIME")`.

Exposée par `_user_dict` (`backend/app/routes/auth.py:44`) — donc dans
`login`, `refresh`, `setup`, `google` et `change_password` d'un seul geste —
sous la forme d'un booléen :

```python
"tutorial_seen": user.tutorial_seen_at is not None,
```

Le front n'a pas besoin de la date, et l'horodatage laisse la liberté de
changer la règle côté serveur plus tard (« re-proposer si vu avant telle
date »).

`PATCH /api/me/preferences` accepte une clé de plus :

```python
if data.get("tutorial_seen"):
    user.tutorial_seen_at = datetime.now(timezone.utc)
```

et renvoie `tutorial_seen` dans sa réponse. Écriture seule vers « vu » : pas de
remise à zéro, l'utilisateur pouvant de toute façon relancer le tour depuis le
menu « ? ».

### Frontend

`AuthUser` (`frontend/src/api/client.ts:371`) gagne `tutorial_seen: boolean`.
`stopTour()` appelle `PATCH /api/me/preferences` puis `updateUser()` pour que
le bouton disparaisse sans rechargement.

### Séquence

1. `ForcePasswordModal` s'affiche si `must_change_password && !passwordModalDismissed` — inchangé.
2. `TourInviteModal` s'affiche si `!showPasswordModal && !tourSeen && !inviteDismissed`.

`AuthenticatedLayout` calcule déjà `showPasswordModal` et le passe au
`HelpProvider`. Quand l'utilisateur ferme le modal mot de passe,
`showPasswordModal` bascule à faux et l'invite apparaît dans la foulée :
l'enchaînement demandé, obtenu sans machine à états ni minuterie.

### Le modal d'invite

Titre « Découvrir l'application », deux phrases, deux actions : *Démarrer le
tutoriel* (lance le tour, ferme le modal) et *Plus tard* (ferme, pose
`inviteDismissed` en `sessionStorage`, **sans** marquer `tutorial_seen`). Ce
second cas est précisément celui qui laisse le bouton bien visible dans la
barre.

### Comptes existants

`tutorial_seen_at` est `NULL` pour tous après migration : les utilisateurs
actuels verront l'invite à leur prochaine connexion. C'est voulu — la
fonctionnalité leur est nouvelle.

## Accessibilité

- Menu « ? » : `button` avec `aria-expanded` / `aria-haspopup`, navigable au
  clavier, fermé par `Échap`.
- Panneau et modals : `role="dialog" aria-modal="true"` avec `aria-label`,
  piégeage du focus, restitution au déclencheur.
- Bulle du tour : `role="dialog"`, contenu en `aria-live="polite"` pour que
  chaque changement d'étape soit annoncé.
- Masque du tour : `aria-hidden`.
- Illustrations : `aria-hidden`, sens porté par la légende.

## Tests

Le backend a une suite pytest établie ; le frontend n'a aucun harnais de test
(ni vitest ni testing-library dans `package.json`). Introduire une
infrastructure de test frontend serait un chantier distinct et non demandé.

**Backend, en TDD** :

1. `PATCH /api/me/preferences` avec `tutorial_seen: true` horodate la colonne.
2. `tutorial_seen` est faux à la création d'un compte, vrai après l'appel.
3. La clé `tutorial_seen` est présente dans la réponse de `login`.

**Frontend, vérification manuelle** : séquence complète pour un compte `admin`
et un compte `skater` — invite après le modal mot de passe, tour complet, saut
des étapes absentes, panneau de doc, persistance après rechargement. Constat
rendu avec captures.

## Hors périmètre

- Recherche plein texte dans la documentation — le volume ne la justifie pas.
- Chapitre partageable par URL — écarté avec l'approche « page routée ».
- Tour multi-pages.
- Documentation des écrans qui n'existent pas encore.

## Volume estimé

~7 nouveaux fichiers frontend (dont `content.tsx`, qui porte l'essentiel du
texte), ~8 attributs et ~15 lignes de câblage dans `App.tsx`, 1 colonne et
~10 lignes backend, 3 tests.
