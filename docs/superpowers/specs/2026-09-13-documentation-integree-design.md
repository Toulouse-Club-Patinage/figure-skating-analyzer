# Documentation intégrée et tutoriel interactif

**Date** : 2026-09-13 (révisé le 2026-09-14)
**Statut** : validé, prêt pour le plan d'implémentation

## Objectif

Donner à l'utilisateur les moyens de comprendre l'application sans la quitter :
un menu « ? » dans la barre supérieure ouvrant une documentation illustrée, et
un **mode tutoriel** qui, tant qu'il est actif, explique chaque écran principal
au moment où l'utilisateur y arrive.

## Décisions structurantes

| Question | Décision |
|---|---|
| Nature des captures | Illustrations recomposées en JSX, données fictives — pas de captures PNG |
| Portée par rôle | Deux parcours : « club » (admin/coach/reader) et « patineur » (skater) |
| Persistance du « déjà vu » | Colonne `users.tutorial_seen_at`, via `PATCH /api/me/preferences` |
| Nature du tutoriel | **Mode persistant** : un overlay par écran, l'utilisateur navigue lui-même |
| Fin du tutoriel | Bouton **« Terminer le tutoriel »** dans le bandeau supérieur, visible en permanence |
| Parcours par écran | Mini-séquence d'étapes propre à chaque écran, avec Précédent / Suivant |
| Écran épuisé | L'overlay s'efface, une **pastille de rappel** subsiste et permet de rejouer |
| Écrans déjà vus | Mémorisés en `localStorage`, **remis à zéro au démarrage** du tutoriel |
| Déclaration des étapes | **Registre central par route** dans `help/tour.ts`, résolu par `matchPath` |
| Ancrage | Attributs `data-tour`, étape sautée si la cible est absente du DOM |
| Séquence d'accueil | Invite dès la fermeture du modal mot de passe, quelle qu'en soit l'issue |
| Comptes existants | Voient l'invite — pas de backfill de `tutorial_seen_at` |

### Pourquoi un mode persistant plutôt qu'une séquence guidée

Un tutoriel qui navigue lui-même doit orchestrer les transitions, attendre le
chargement des données, et gérer les états vides d'une installation neuve —
beaucoup de fragilité pour un gain discutable. En faisant du tutoriel un
**mode** que l'utilisateur porte avec lui, la navigation reste la sienne :
il découvre chaque écran à son rythme, dans l'ordre qui lui convient, et
l'application n'a qu'à répondre « voici ce qu'il y a à savoir sur cet écran ».

Le coût de ce choix est qu'il faut signaler en permanence que le mode est actif,
sans quoi l'utilisateur s'y perd. D'où le bandeau et la pastille (voir plus bas).

### Pourquoi des illustrations JSX plutôt que des captures

Aucune donnée personnelle de patineur ne se retrouve dans la documentation ;
les illustrations suivent le design system et ne périment pas au premier
ajustement de l'UI ; elles restent lisibles en responsive là où une capture de
tableau large ne l'est pas.

## Architecture

### Un contexte `HelpProvider` unique

Un contexte React possède tout l'état — panneau de doc ouvert et sur quel
chapitre, mode tutoriel actif, index de l'étape courante, écrans déjà vus,
invite due — et l'expose aux composants visuels. Le renvoi d'une étape vers un
chapitre est un appel direct, sans couplage entre composants.

Deux alternatives écartées : l'état local dans `AuthenticatedLayout` (qui
alourdirait un `App.tsx` déjà à 464 lignes) et la documentation comme page
routée `/aide` (qui ferait quitter sa page à l'utilisateur).

### Fichiers

```
frontend/src/help/
  HelpContext.tsx      État partagé, mode tutoriel, orchestration de l'accueil
  HelpMenu.tsx         Le bouton « ? » et son menu, à côté de la cloche
  DocPanel.tsx         Panneau latéral de documentation (sommaire + chapitre)
  TourOverlay.tsx      Masque, surlignage, bulle de l'étape courante
  TourBanner.tsx       Bandeau « Mode tutoriel » + « Terminer le tutoriel »
  TourReminder.tsx     Pastille de rappel quand l'écran courant est épuisé
  TourInviteModal.tsx  Modal « Découvrir l'application ? » (1re connexion)
  StartTourButton.tsx  Bouton visible tant que le tutoriel n'a pas été suivi
  content.tsx          Chapitres de doc + illustrations JSX (données)
  tour.ts              Registre des étapes par route
```

### Montage dans le shell

`HelpProvider` enveloppe le contenu de `AuthenticatedLayout`, à l'intérieur de
`JobProvider`. La barre supérieure reçoit `<StartTourButton />` et
`<HelpMenu />` avant `<NotificationBell />`. `TourBanner` se place juste sous
la barre supérieure, dans le flux (il pousse le contenu vers le bas plutôt que
de le recouvrir — un bandeau qui masque une partie de l'écran qu'il prétend
expliquer serait absurde). Les couches flottantes (`DocPanel`, `TourOverlay`,
`TourReminder`, `TourInviteModal`) sont rendues en fin de layout.

### Empilement (z-index)

L'existant : sidebar `z-40`, barre supérieure `z-30`, modals `z-50`.

| Couche | z-index |
|---|---|
| `TourOverlay` | `z-[60]` |
| `TourReminder` | `z-[55]` |
| `DocPanel` / `TourInviteModal` | `z-50` |
| `TourBanner` | dans le flux, `sticky` sous la barre |

`TourInviteModal` et `ForcePasswordModal` ne sont jamais simultanés par
construction (voir « Séquence d'accueil »).

## Le mode tutoriel

### Cycle de vie

1. L'utilisateur démarre le tutoriel (modal d'invite, bouton du bandeau, ou
   menu « ? »). La liste des écrans vus est **vidée**, le mode passe à actif.
2. Le bandeau « Mode tutoriel » apparaît sous la barre supérieure et y reste.
3. À chaque changement de route, le contexte résout la route courante dans le
   registre. Si un jeu d'étapes existe **et** que l'écran n'a pas déjà été vu,
   le mini-parcours démarre.
4. L'utilisateur enchaîne les étapes avec *Suivant*. À la dernière, *Terminer
   cet écran* referme l'overlay et marque l'écran comme vu.
5. L'overlay effacé, la **pastille de rappel** s'affiche : elle rappelle que le
   mode est actif et propose de revoir l'écran courant.
6. L'utilisateur navigue ; retour au point 3.
7. **« Terminer le tutoriel »** dans le bandeau met fin au mode, persiste
   `tutorial_seen`, et fait disparaître bandeau et pastille.

### Résolution de la route

Le registre est une table de motifs de route vers des listes d'étapes. La
résolution utilise `matchPath` de React Router — indispensable pour
`/patineurs/:id/analyse`, qui ne peut pas être comparé par égalité. Les motifs
sont essayés du plus spécifique au plus général, le premier qui matche gagne.

### Écrans couverts

**Parcours club** (7) : Tableau de bord · Patineurs (liste) · Analyse
patineur · Compétitions · Club / statistiques · Programme · Entraînement.

**Parcours patineur** (3) : Analyse patineur · Mes patineurs · Mon compte.

Volontairement laissés de côté : Administration (public averti, la doc la
couvre), Détail compétition, et les pages secondaires. Ajouter un écran plus
tard consiste à ajouter une entrée au registre et les `data-tour`
correspondants.

Un même motif de route peut porter des étapes différentes selon le parcours :
`/patineurs/:id/analyse` est le cœur du parcours patineur et une page parmi
d'autres du parcours club. Le filtrage par `audience` s'applique donc **à
l'intérieur** de chaque jeu d'étapes.

### Étapes dont la cible est absente

Le filtrage par présence dans le DOM reste indispensable : `HomePage` ne rend
ses indicateurs que lorsque des données existent, donc sur une installation
neuve, la moitié des ancres du tableau de bord manquent. Les étapes
correspondantes sont éliminées au démarrage du mini-parcours. Si toutes les
étapes d'un écran tombent, l'écran est marqué vu sans rien afficher — mieux
vaut un tutoriel silencieux qu'un cadre autour du vide.

### Surlignage

À chaque étape, `TourOverlay` résout `[data-tour="<id>"]`, lit son
`getBoundingClientRect()` et rend :

- un masque en **quatre rectangles** autour de la cible — plus fiable à
  positionner qu'un `box-shadow` géant, et laisse la cible cliquable ;
- un anneau `ring-2 ring-primary rounded-xl` sur la cible ;
- une **bulle** au-dessus ou en dessous selon la place : titre, deux ou trois
  phrases, compteur « 3 / 5 », *Précédent* / *Suivant* (ou *Terminer cet
  écran*), et *En savoir plus →* quand l'étape porte un `chapterId`.

Le rectangle est recalculé sur `resize` et `scroll`. Avant mesure, la cible est
amenée dans la vue via `scrollIntoView({ block: "center" })`.

### Le bandeau

Sous la barre supérieure, sur toute la largeur du contenu : fond `primary`,
icône `school`, texte « Mode tutoriel — les écrans que vous ouvrez vous sont
expliqués », et à droite un bouton **« Terminer le tutoriel »** en
`bg-on-primary text-primary`, donc franchement visible. Sur mobile, le texte
explicatif est masqué, le bouton reste.

### La pastille de rappel

En bas à droite, `fixed`, visible quand le mode est actif et qu'aucun overlay
n'est affiché : « Tutoriel actif » avec un bouton *Revoir cet écran* (absent si
l'écran courant n'a pas d'étapes). Elle donne le moyen de rejouer un
mini-parcours cliqué trop vite, et surtout elle empêche l'utilisateur d'oublier
dans quel état il se trouve.

### Mémorisation des écrans vus

Clé `localStorage` `tutorial_screens_seen`, contenant la liste des motifs de
route déjà parcourus. `localStorage` plutôt qu'un `useState` pour survivre à un
rechargement de page en cours de tutoriel.

**La liste est vidée au démarrage du tutoriel, pas à sa fin.** Sans quoi un
utilisateur relançant le tutoriel des mois plus tard retrouverait tous les
écrans marqués vus et n'obtiendrait aucun overlay — le tutoriel paraîtrait
cassé. La remise à zéro à `startTour()` garantit qu'un tutoriel relancé est
toujours complet.

## Le menu « ? » et la documentation

### Le bouton et son menu

Le bouton reprend la facture de la cloche : `material-symbols-outlined`
(`help`), couleur `on-surface-variant`. Le menu déroulant reprend la largeur et
le style du panneau de notifications (`w-80`, `rounded-xl`, `shadow-lg`), avec
le pattern `useRef` + `mousedown` de `NotificationBell` pour la fermeture au
clic extérieur.

Contenu : **Démarrer le tutoriel** (ou **Terminer le tutoriel** si le mode est
actif), un séparateur par changement de surface — pas de bordure, conformément
au design system — puis la liste des chapitres du parcours.

### Le panneau

Glisse depuis la droite : `fixed right-0 top-0 h-screen w-full max-w-xl`,
surface `surface-container-lowest`, fond `bg-on-surface/40`. Pleine largeur sur
mobile. En-tête (titre + fermer), corps du chapitre, pied de navigation
« chapitre précédent / suivant ».

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
plausibles) : mini-sidebar, extrait de tableau de scores. Chaque illustration
est décorative — conteneur `aria-hidden`, légende textuelle portant
l'information — pour que la documentation reste compréhensible sans elles.

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

Exposée par `_user_dict` (`backend/app/routes/auth.py:44`) — donc dans `login`,
`refresh`, `setup`, `google` et `change_password` d'un seul geste :

```python
"tutorial_seen": user.tutorial_seen_at is not None,
```

`PATCH /api/me/preferences` accepte une clé de plus :

```python
if data.get("tutorial_seen"):
    user.tutorial_seen_at = datetime.now(timezone.utc)
```

et renvoie `tutorial_seen` dans sa réponse. Écriture seule vers « vu ».

`tutorial_seen` est persisté **à la fin du mode** (« Terminer le tutoriel »),
pas à la fin du premier écran : c'est bien le tutoriel entier qui a été suivi.

### Frontend

`AuthUser` gagne `tutorial_seen: boolean`. La fin du mode appelle
`PATCH /api/me/preferences` puis `updateUser()` pour que le bouton de
démarrage disparaisse sans rechargement.

### Séquence

1. `ForcePasswordModal` s'affiche si `must_change_password && !passwordModalDismissed` — inchangé.
2. `TourInviteModal` s'affiche si `!showPasswordModal && !tourSeen && !inviteDismissed && !tourActive`.

`AuthenticatedLayout` calcule déjà `showPasswordModal` et le passe au
`HelpProvider`. Quand l'utilisateur ferme le modal mot de passe,
`showPasswordModal` bascule à faux et l'invite apparaît dans la foulée :
l'enchaînement demandé, sans machine à états ni minuterie.

### Le modal d'invite

Titre « Découvrir l'application », deux phrases, deux actions : *Démarrer le
tutoriel* (active le mode, ferme le modal) et *Plus tard* (ferme, pose
`inviteDismissed` en `sessionStorage`, **sans** marquer `tutorial_seen`). Ce
second cas laisse le bouton « Tutoriel » visible dans la barre.

### Comptes existants

`tutorial_seen_at` est `NULL` pour tous après migration : les utilisateurs
actuels verront l'invite à leur prochaine connexion. C'est voulu.

## Accessibilité

- Menu « ? » : `button` avec `aria-expanded` / `aria-haspopup`, clavier,
  `Échap`.
- Panneau et modals : `role="dialog" aria-modal="true"` avec `aria-label`,
  piégeage du focus, restitution au déclencheur.
- Bulle du tour : `role="dialog"`, contenu en `aria-live="polite"` pour que
  chaque changement d'étape soit annoncé.
- Bandeau : `role="status"`, pour que l'activation du mode soit annoncée une
  fois sans interrompre.
- Masque et illustrations : `aria-hidden`, sens porté par la légende.
- `Échap` pendant un overlay ferme l'overlay **et marque l'écran vu**, sans
  mettre fin au mode — sortir d'une explication n'est pas sortir du tutoriel.

## Tests

Le backend a une suite pytest établie ; le frontend n'a aucun harnais de test
(ni vitest ni testing-library dans `package.json`). Introduire une
infrastructure de test frontend serait un chantier distinct et non demandé.

**Backend, en TDD** :

1. `PATCH /api/me/preferences` avec `tutorial_seen: true` horodate la colonne.
2. L'écriture ne va que vers « vu » : `false` ne remet pas à zéro.
3. Le champ n'écrase pas `email_notifications` (endpoint partagé avec
   `ProfilePage`).
4. La clé `tutorial_seen` est présente dans la réponse de `login`.

**Frontend, vérification manuelle** : parcours complet pour un compte `admin` et
un compte `skater` — invite après le modal mot de passe, overlay sur chaque
écran couvert, non-répétition sur un écran déjà vu, pastille et « Revoir cet
écran », persistance du mode au rechargement, fin par le bandeau. Constat rendu
avec le détail de chaque point.

## Hors périmètre

- Navigation pilotée par le tutoriel — c'est le choix structurant de cette
  révision.
- Recherche plein texte dans la documentation.
- Chapitre partageable par URL.
- Overlay sur les écrans non listés ci-dessus.

## Volume estimé

~10 nouveaux fichiers frontend, des `data-tour` dans `App.tsx` et dans les 8
pages couvertes, 1 colonne et ~10 lignes backend, 4 tests.
