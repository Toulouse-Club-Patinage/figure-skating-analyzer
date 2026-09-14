# Documentation intégrée et tutoriel interactif — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un menu « ? » ouvrant une documentation illustrée, et un **mode tutoriel** persistant qui explique chaque écran principal au moment où l'utilisateur y arrive.

**Architecture:** Un contexte React `HelpProvider` monté dans `AuthenticatedLayout` possède tout l'état : panneau de doc, mode tutoriel actif, étape courante, écrans déjà vus. Le tutoriel ne navigue jamais lui-même — il réagit aux changements de route en résolvant la route courante dans un registre central (`help/tour.ts`) via `matchPath`. Les étapes ciblent des attributs `data-tour` et celles dont la cible est absente du DOM sont éliminées. Le mode ne s'arrête que sur « Terminer le tutoriel », ce qui persiste alors `users.tutorial_seen_at`.

**Tech Stack:** React 19 + TypeScript + Tailwind CSS (aucune bibliothèque de composants), React Router 6 (`matchPath`), Litestar + SQLAlchemy async + SQLite, pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-09-13-documentation-integree-design.md`

## Global Constraints

- **Tout le texte d'interface est en français.** Sans exception, `aria-label` et messages d'erreur compris.
- **Tailwind CSS uniquement**, aucune bibliothèque de composants, aucune dépendance npm nouvelle.
- **Pas de bordure pour le sectionnement** — superposition de surfaces (`surface`, `surface-container-low`, `surface-container`, `surface-container-lowest`).
- **Ne jamais utiliser la classe `bg-scrim`** : le token `scrim` n'est pas défini dans `frontend/tailwind.config.js` et ne produit aucune couleur. Pour les fonds de modal, utiliser `bg-on-surface/40` comme `ForcePasswordModal`.
- **Polices** : `font-headline` (Manrope) pour les titres, corps par défaut (Inter), icônes via `<span className="material-symbols-outlined">`.
- **Couleurs** : `on-surface`, `on-surface-variant`, `primary`, `on-primary`, `error`. Tous vérifiés présents dans `tailwind.config.js`.
- **Empilement** : `TourOverlay` `z-[60]`, `TourReminder` `z-[55]`, `DocPanel` / `TourInviteModal` `z-50`. Sidebar existante `z-40`, barre supérieure `z-30`.
- **Commandes** : `npm` et `uv` ne sont pas dans le PATH. Préfixer par `PATH="/opt/homebrew/bin:$PATH"`.
- **Tests backend** : `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest`.
- **Aucun harnais de test frontend n'existe** et ce plan n'en introduit pas. Les tâches frontend se vérifient par `tsc --noEmit` et par contrôle manuel.
- **Conventions de test** : la fixture `admin_user` renvoie un tuple `(user, password)` (`conftest.py:59`), mot de passe `testpass123` ; `POST /api/auth/login` répond `200` ; `@pytest.mark.asyncio` est posé explicitement sur chaque test malgré `asyncio_mode = "auto"`.
- **Messages de commit en français**, préfixe conventionnel (`feat:`, `test:`, `docs:`).

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `backend/app/models/user.py` | *(modifié)* colonne `tutorial_seen_at` |
| `backend/app/database.py` | *(modifié)* entrée de migration |
| `backend/app/routes/auth.py` | *(modifié)* `_user_dict` expose `tutorial_seen` |
| `backend/app/routes/me.py` | *(modifié)* `PATCH /preferences` accepte `tutorial_seen` |
| `backend/tests/test_tutorial_seen.py` | *(créé)* les 4 tests backend |
| `frontend/src/api/client.ts` | *(modifié)* `AuthUser.tutorial_seen`, signature `updatePreferences` |
| `frontend/src/help/content.tsx` | *(créé)* chapitres + illustrations JSX |
| `frontend/src/help/tour.ts` | *(créé)* registre des étapes par route + résolution |
| `frontend/src/help/HelpContext.tsx` | *(créé)* état, mode tutoriel, orchestration |
| `frontend/src/help/DocPanel.tsx` | *(créé)* panneau de documentation |
| `frontend/src/help/HelpMenu.tsx` | *(créé)* bouton « ? » et menu |
| `frontend/src/help/TourOverlay.tsx` | *(créé)* masque, surlignage, bulle |
| `frontend/src/help/TourBanner.tsx` | *(créé)* bandeau + « Terminer le tutoriel » |
| `frontend/src/help/TourReminder.tsx` | *(créé)* pastille de rappel |
| `frontend/src/help/TourInviteModal.tsx` | *(créé)* modal de première connexion |
| `frontend/src/help/StartTourButton.tsx` | *(créé)* bouton de démarrage |
| `frontend/src/App.tsx` | *(modifié)* montage, bandeau, ancres du shell |
| 8 pages sous `frontend/src/pages/` | *(modifiées)* ancres `data-tour` propres à chaque écran |

**Ordre** : backend (1–2) → types (3) → données de contenu (4–5) → contexte (6) → composants visuels (7–10) → câblage du shell (11) → ancres des pages (12) → vérification (13).

---

### Task 1 : Colonne `tutorial_seen_at` et exposition dans `AuthUser`

**Files:**
- Modify: `backend/app/models/user.py` (après `last_login_at`)
- Modify: `backend/app/database.py` (fin de la liste `_MIGRATIONS`)
- Modify: `backend/app/routes/auth.py:44-51` (`_user_dict`)
- Test: `backend/tests/test_tutorial_seen.py` (créé)

**Interfaces:**
- Consumes: rien.
- Produits : `User.tutorial_seen_at: datetime | None` ; la clé `"tutorial_seen": bool` dans toutes les réponses d'authentification.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/tests/test_tutorial_seen.py` :

```python
# backend/tests/test_tutorial_seen.py
"""État « tutoriel vu » : colonne, exposition, et bascule par les préférences.

Le tutoriel est proposé à la première connexion. Cet état doit survivre au
changement d'appareil, d'où une colonne en base plutôt qu'un localStorage.
"""

import pytest


@pytest.mark.asyncio
async def test_login_expose_tutorial_seen_faux_par_defaut(client, admin_user):
    user, password = admin_user
    resp = await client.post(
        "/api/auth/login",
        json={"email": user.email, "password": password},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["tutorial_seen"] is False
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_tutorial_seen.py -v
```

Attendu : ÉCHEC sur `KeyError: 'tutorial_seen'`.

- [ ] **Step 3: Ajouter la colonne au modèle**

Dans `backend/app/models/user.py`, après `last_login_at` :

```python
    tutorial_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
```

- [ ] **Step 4: Ajouter l'entrée de migration**

À la fin de la liste `_MIGRATIONS` dans `backend/app/database.py` :

```python
        ("users", "tutorial_seen_at", "DATETIME"),
```

Aucun backfill : les comptes existants gardent `NULL` et verront donc l'invite,
ce qui est voulu.

- [ ] **Step 5: Exposer le booléen**

Dans `_user_dict` (`backend/app/routes/auth.py`), ajouter :

```python
        "tutorial_seen": user.tutorial_seen_at is not None,
```

`_user_dict` est l'unique sérialiseur de `login`, `refresh`, `setup`, `google`
et `change_password` : cette seule ligne couvre les cinq.

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_tutorial_seen.py -v
```

Attendu : SUCCÈS.

- [ ] **Step 7: Vérifier l'absence de régression**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest -q
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/user.py backend/app/database.py backend/app/routes/auth.py backend/tests/test_tutorial_seen.py
git commit -m "feat(aide): colonne tutorial_seen_at exposée dans AuthUser"
```

---

### Task 2 : Bascule via `PATCH /api/me/preferences`

**Files:**
- Modify: `backend/app/routes/me.py:122-134` (`update_preferences`)
- Test: `backend/tests/test_tutorial_seen.py` (complété)

**Interfaces:**
- Consumes: `User.tutorial_seen_at` (Task 1).
- Produits : `PATCH /api/me/preferences` accepte `{"tutorial_seen": true}` et renvoie `{"email_notifications": bool, "tutorial_seen": bool}`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `backend/tests/test_tutorial_seen.py` :

```python
@pytest.mark.asyncio
async def test_preferences_marque_le_tutoriel_comme_vu(
    client, admin_user, admin_token, db_session
):
    user, _ = admin_user
    resp = await client.patch(
        "/api/me/preferences",
        json={"tutorial_seen": True},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["tutorial_seen"] is True

    await db_session.refresh(user)
    assert user.tutorial_seen_at is not None


@pytest.mark.asyncio
async def test_preferences_ne_remet_jamais_a_zero(
    client, admin_user, admin_token, db_session
):
    """Écriture seule vers « vu » : relancer le tutoriel ne réarme pas l'invite."""
    user, _ = admin_user
    for payload in ({"tutorial_seen": True}, {"tutorial_seen": False}):
        await client.patch(
            "/api/me/preferences",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
        )

    await db_session.refresh(user)
    assert user.tutorial_seen_at is not None


@pytest.mark.asyncio
async def test_preferences_conserve_les_notifications_email(
    client, admin_user, admin_token, db_session
):
    """Le nouveau champ ne doit pas écraser la préférence voisine."""
    user, _ = admin_user
    await client.patch(
        "/api/me/preferences",
        json={"email_notifications": False},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    await client.patch(
        "/api/me/preferences",
        json={"tutorial_seen": True},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    await db_session.refresh(user)
    assert user.email_notifications is False
    assert user.tutorial_seen_at is not None
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_tutorial_seen.py -v
```

Attendu : les trois nouveaux échouent.

- [ ] **Step 3: Implémenter**

Dans `update_preferences` (`backend/app/routes/me.py`), après le bloc
`email_notifications` et en remplaçant le `commit` / `return` existants :

```python
    if data.get("tutorial_seen"):
        user.tutorial_seen_at = datetime.now(timezone.utc)
    await session.commit()
    return {
        "email_notifications": user.email_notifications,
        "tutorial_seen": user.tutorial_seen_at is not None,
    }
```

Le `if` sans `else` est délibéré : l'écriture ne va que vers « vu ».
`datetime` et `timezone` sont déjà importés (`backend/app/routes/me.py:4`).

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_tutorial_seen.py -v
```

Attendu : les quatre tests du fichier passent.

- [ ] **Step 5: Vérifier l'absence de régression**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest -q
```

`ProfilePage.tsx` consomme ce endpoint : la clé `email_notifications` doit
rester présente, ce que le troisième test garantit.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routes/me.py backend/tests/test_tutorial_seen.py
git commit -m "feat(aide): bascule tutorial_seen via les préférences"
```

---

### Task 3 : Types frontend et client d'API

**Files:**
- Modify: `frontend/src/api/client.ts:371-378` (`AuthUser`), `:1008-1012` (`updatePreferences`)

**Interfaces:**
- Consumes: la clé `tutorial_seen` (Tasks 1–2).
- Produits : `AuthUser.tutorial_seen: boolean` ; `api.me.updatePreferences(data: { email_notifications?: boolean; tutorial_seen?: boolean }): Promise<{ email_notifications: boolean; tutorial_seen: boolean }>`.

- [ ] **Step 1: Étendre `AuthUser`**

Dans l'interface `AuthUser`, après `has_password` :

```ts
  tutorial_seen: boolean;
```

- [ ] **Step 2: Élargir la signature de `updatePreferences`**

```ts
    updatePreferences: (data: {
      email_notifications?: boolean;
      tutorial_seen?: boolean;
    }) =>
      request<{ email_notifications: boolean; tutorial_seen: boolean }>(
        "/me/preferences",
        {
          method: "PATCH",
          body: JSON.stringify(data),
        }
      ),
```

Les deux champs deviennent optionnels : `ProfilePage.tsx:25` appelle avec le
seul `email_notifications` et continue de compiler.

- [ ] **Step 3: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(aide): types frontend pour tutorial_seen"
```

---

### Task 4 : Contenu de la documentation

**Files:**
- Create: `frontend/src/help/content.tsx`

**Interfaces:**
- Consumes: rien (fichier de données pur).
- Produits :
  - `type Audience = "club" | "skater"`
  - `type Chapter = { id: string; title: string; icon: string; audience: Audience[]; adminOnly?: boolean; body: () => ReactNode }`
  - `const CHAPTERS: Chapter[]`
  - `function chaptersFor(audience: Audience): Chapter[]`

- [ ] **Step 1: Créer le fichier avec types et illustrations**

```tsx
import type { ReactNode } from "react";

export type Audience = "club" | "skater";

export type Chapter = {
  id: string;
  title: string;
  icon: string;
  audience: Audience[];
  /** Affiche un badge « Administrateur » : le chapitre décrit un écran
   *  réservé aux administrateurs. */
  adminOnly?: boolean;
  body: () => ReactNode;
};

/** Les illustrations rejouent l'interface avec des données fictives plutôt que
 *  d'embarquer des captures : aucune donnée de patineur réel n'entre dans la
 *  documentation, et le rendu ne périme pas au premier ajustement de l'UI.
 *  Elles sont décoratives — la légende porte l'information. */
function Figure({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="my-4">
      <div
        aria-hidden="true"
        className="bg-surface-container rounded-xl p-3 overflow-x-auto"
      >
        {children}
      </div>
      <figcaption className="text-xs text-on-surface-variant mt-2">
        {caption}
      </figcaption>
    </figure>
  );
}

function SidebarFigure() {
  const items = [
    { icon: "dashboard", label: "TABLEAU DE BORD", active: true },
    { icon: "people", label: "PATINEURS", active: false },
    { icon: "emoji_events", label: "COMPÉTITIONS", active: false },
    { icon: "bar_chart", label: "CLUB", active: false },
  ];
  return (
    <div className="bg-surface-container-low rounded-lg py-2 w-56">
      {items.map((it) => (
        <div
          key={it.label}
          className={
            it.active
              ? "bg-surface-container-lowest text-primary shadow-sm rounded-lg mx-2 my-0.5 px-3 py-2 flex items-center gap-2 font-bold"
              : "text-on-surface-variant rounded-lg mx-2 my-0.5 px-3 py-2 flex items-center gap-2"
          }
        >
          <span className="material-symbols-outlined text-lg">{it.icon}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider">
            {it.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScoreRowFigure() {
  const rows = [
    { el: "2A", base: "3.30", goe: "+0.66", total: "3.96" },
    { el: "3T", base: "4.20", goe: "-0.84", total: "3.36" },
    { el: "FCSp3", base: "2.80", goe: "+0.28", total: "3.08" },
  ];
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-on-surface-variant text-left">
          <th className="py-1 font-medium">Élément</th>
          <th className="py-1 font-medium">Base</th>
          <th className="py-1 font-medium">GOE</th>
          <th className="py-1 font-medium">Total</th>
        </tr>
      </thead>
      <tbody className="text-on-surface">
        {rows.map((r) => (
          <tr key={r.el} className="bg-surface-container-lowest">
            <td className="py-1.5 px-1 font-mono">{r.el}</td>
            <td className="py-1.5 px-1 font-mono">{r.base}</td>
            <td
              className={`py-1.5 px-1 font-mono ${
                r.goe.startsWith("-") ? "text-error" : "text-primary"
              }`}
            >
              {r.goe}
            </td>
            <td className="py-1.5 px-1 font-mono font-bold">{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Rédiger les chapitres du parcours club**

```tsx
const CLUB: Audience[] = ["club"];
const TOUS: Audience[] = ["club", "skater"];

const CHAPITRES_CLUB: Chapter[] = [
  {
    id: "premiers-pas",
    title: "Premiers pas",
    icon: "flag",
    audience: CLUB,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          L'application rassemble les résultats de compétition de vos patineurs
          et les met en perspective : évolution des scores, détail des éléments
          techniques, comparaison au sein du club.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Le menu de gauche donne accès aux grandes sections. La barre du haut
          affiche le titre de la page courante, vos notifications et ce menu
          d'aide.
        </p>
        <Figure caption="Le menu de navigation, ici sur le tableau de bord.">
          <SidebarFigure />
        </Figure>
      </>
    ),
  },
  {
    id: "tableau-de-bord",
    title: "Le tableau de bord",
    icon: "dashboard",
    audience: CLUB,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Le tableau de bord est la page d'accueil. Il résume la saison : nombre
          de patineurs actifs, compétitions suivies, programmes notés et
          podiums.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          En dessous, les meilleurs scores de la saison, les progressions les
          plus fortes, les médailles et les compétitions récentes. Le sélecteur
          en haut à droite change de saison, et le bouton voisin exporte un
          rapport de saison en PDF.
        </p>
      </>
    ),
  },
  {
    id: "patineurs",
    title: "Les patineurs et leur analyse",
    icon: "people",
    audience: CLUB,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          La section <strong>Patineurs</strong> liste les patineurs connus de
          l'application. Un clic sur l'un d'eux ouvre sa page d'analyse.
        </p>
        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          La page d'analyse
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Elle réunit l'évolution des scores au fil de la saison, la répartition
          des composantes de programme, et le détail des éléments techniques
          avec leur note d'exécution.
        </p>
        <Figure caption="Extrait du détail technique : note de base, GOE, et total par élément.">
          <ScoreRowFigure />
        </Figure>
      </>
    ),
  },
  {
    id: "competitions",
    title: "Les compétitions et l'import",
    icon: "emoji_events",
    audience: CLUB,
    adminOnly: true,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Les résultats sont importés depuis l'adresse du site de la
          compétition. L'application récupère les feuilles de notes et en
          extrait les scores.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Un import peut être relancé si la compétition a été mise à jour depuis
          la dernière récupération. Le journal d'import indique ce qui a été lu
          et ce qui a posé problème.
        </p>
      </>
    ),
  },
  {
    id: "statistiques-club",
    title: "Les statistiques du club",
    icon: "bar_chart",
    audience: CLUB,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        La section <strong>Club</strong> agrège les résultats sur la saison ou
        sur une compétition donnée : nombre de participations, scores moyens par
        catégorie, et comparaison entre patineurs.
      </p>
    ),
  },
  {
    id: "programme",
    title: "Le constructeur de programme",
    icon: "sports_score",
    audience: CLUB,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        Le constructeur permet de composer un programme élément par élément et
        d'en estimer la note technique. Les règles de la catégorie choisie sont
        vérifiées au fur et à mesure et les écarts sont signalés.
      </p>
    ),
  },
  {
    id: "entrainement",
    title: "Le suivi d'entraînement",
    icon: "fitness_center",
    audience: CLUB,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        Lorsque le suivi d'entraînement est activé, chaque patineur dispose d'un
        journal : séances, ressenti, incidents, et bilans réguliers rédigés par
        l'entraîneur.
      </p>
    ),
  },
  {
    id: "administration",
    title: "Administration",
    icon: "settings",
    audience: CLUB,
    adminOnly: true,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        L'administration regroupe la gestion des comptes, les réglages du club,
        les demandes de création de compte, et le suivi des tâches d'import.
      </p>
    ),
  },
];
```

- [ ] **Step 3: Rédiger les chapitres du parcours patineur et exporter**

```tsx
const CHAPITRES_PATINEUR: Chapter[] = [
  {
    id: "bienvenue",
    title: "Bienvenue",
    icon: "waving_hand",
    audience: ["skater"],
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Cet espace rassemble les résultats de compétition de votre patineur.
          Vous y retrouvez ses notes, leur évolution, et le détail de chaque
          programme.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Le menu de gauche mène directement à sa page. Si plusieurs patineurs
          sont rattachés à votre compte, il affiche la liste.
        </p>
      </>
    ),
  },
  {
    id: "page-patineur",
    title: "La page de mon patineur",
    icon: "ice_skating",
    audience: ["skater"],
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        La page réunit les compétitions disputées, le score obtenu à chacune, et
        le détail de chaque programme. Les graphiques montrent l'évolution au
        fil de la saison.
      </p>
    ),
  },
  {
    id: "comprendre-les-scores",
    title: "Comprendre les scores",
    icon: "calculate",
    audience: TOUS,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Une note se compose de deux parties : la{" "}
          <strong>note technique</strong>, qui additionne la valeur des éléments
          réalisés, et les <strong>composantes de programme</strong>, qui
          évaluent la présentation d'ensemble.
        </p>
        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          La note technique
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Chaque élément a une valeur de base. Les juges y ajoutent ou en
          retranchent une note d'exécution, le <strong>GOE</strong>, selon la
          qualité de réalisation.
        </p>
        <Figure caption="Un GOE positif s'ajoute à la valeur de base, un GOE négatif s'en retranche.">
          <ScoreRowFigure />
        </Figure>
        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Les composantes
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Elles notent le patinage lui-même : qualité des carres, présentation,
          interprétation de la musique. Elles varient plus lentement que la note
          technique d'une compétition à l'autre.
        </p>
      </>
    ),
  },
  {
    id: "mon-compte",
    title: "Mon compte et mes patineurs",
    icon: "account_circle",
    audience: TOUS,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Votre compte est accessible en bas du menu de gauche. Vous pouvez y
          changer votre mot de passe et vos préférences de notification.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Si un second enfant prend une licence en cours de saison, vous pouvez
          le rattacher à votre compte depuis la page{" "}
          <strong>Mes patineurs</strong>, avec son numéro de licence et sa date
          de naissance.
        </p>
      </>
    ),
  },
];

export const CHAPTERS: Chapter[] = [...CHAPITRES_CLUB, ...CHAPITRES_PATINEUR];

export function chaptersFor(audience: Audience): Chapter[] {
  return CHAPTERS.filter((c) => c.audience.includes(audience));
}
```

Noter que `mon-compte` et `comprendre-les-scores` sont en `TOUS` : les étapes
du parcours club y renvoient aussi.

- [ ] **Step 4: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/help/content.tsx
git commit -m "feat(aide): chapitres de documentation et illustrations"
```

---

### Task 5 : Registre des étapes par route

**Files:**
- Create: `frontend/src/help/tour.ts`

**Interfaces:**
- Consumes: `Audience` depuis `./content` (Task 4), `matchPath` de `react-router-dom`.
- Produits :
  - `type TourStep = { target: string; title: string; body: string; chapterId?: string; audience: Audience[] }`
  - `type ScreenTour = { pattern: string; label: string; steps: TourStep[] }`
  - `const SCREEN_TOURS: ScreenTour[]`
  - `function screenTourFor(pathname: string, audience: Audience): { pattern: string; label: string; steps: TourStep[] } | null` — résout la route, filtre par audience **et** par présence de la cible dans le DOM.

- [ ] **Step 1: Créer les types et le registre du shell**

```ts
import { matchPath } from "react-router-dom";
import type { Audience } from "./content";

export type TourStep = {
  /** Valeur de l'attribut data-tour portée par la cible. */
  target: string;
  title: string;
  body: string;
  /** Chapitre ouvert par « En savoir plus ». */
  chapterId?: string;
  audience: Audience[];
};

export type ScreenTour = {
  /** Motif de route au sens de React Router (`matchPath`). */
  pattern: string;
  /** Nom de l'écran, affiché dans la pastille de rappel. */
  label: string;
  steps: TourStep[];
};

const TOUS: Audience[] = ["club", "skater"];
const CLUB: Audience[] = ["club"];
const SKATER: Audience[] = ["skater"];

/** Étapes communes à tous les écrans : les repères du shell. Elles ouvrent le
 *  mini-parcours du premier écran visité, puis ne sont plus rejouées — d'où
 *  leur présence dans le seul jeu du tableau de bord et de la page patineur,
 *  qui sont les deux points d'entrée possibles. */
const REPERES: TourStep[] = [
  {
    target: "sidebar-nav",
    title: "Le menu de navigation",
    body: "Toutes les sections de l'application sont ici. Le menu se replie avec la flèche en bas pour gagner de la place.",
    chapterId: "premiers-pas",
    audience: CLUB,
  },
  {
    target: "notifications",
    title: "Vos notifications",
    body: "La cloche signale les nouveautés qui vous concernent. La pastille indique le nombre de messages non lus.",
    audience: TOUS,
  },
  {
    target: "help-menu",
    title: "L'aide, à tout moment",
    body: "Ce menu rouvre la documentation et permet de relancer ce tutoriel quand vous le souhaitez.",
    audience: TOUS,
  },
  {
    target: "user-account",
    title: "Votre compte",
    body: "Mot de passe, préférences de notification et déconnexion se trouvent ici.",
    chapterId: "mon-compte",
    audience: TOUS,
  },
];
```

- [ ] **Step 2: Déclarer les écrans**

À la suite, dans le même fichier. L'ordre compte : `matchPath` est essayé
motif par motif et le premier qui matche gagne, donc les motifs spécifiques
précèdent les génériques.

```ts
export const SCREEN_TOURS: ScreenTour[] = [
  {
    pattern: "/patineurs/:id/analyse",
    label: "l'analyse d'un patineur",
    steps: [
      // Un compte `skater` n'atteint jamais `/` (il y est redirigé) : ses
      // repères de shell s'attachent donc à sa page d'entrée, qui est
      // celle-ci. Un compte « club » les voit sur le tableau de bord.
      {
        target: "sidebar-nav",
        title: "Votre espace",
        body: "Ce menu mène à la page de votre patineur. Si plusieurs patineurs sont rattachés à votre compte, il affiche la liste.",
        chapterId: "bienvenue",
        audience: SKATER,
      },
      ...REPERES.filter(
        (s) => s.target !== "sidebar-nav" && s.audience.includes("skater")
      ),
      {
        target: "analyse-entete",
        title: "La fiche du patineur",
        body: "Nom, club et catégorie du patineur, avec le sélecteur de saison pour changer de période.",
        chapterId: "page-patineur",
        audience: SKATER,
      },
      {
        target: "analyse-entete",
        title: "La fiche du patineur",
        body: "Nom, club et catégorie, avec le sélecteur de saison. Le bouton d'export produit un rapport PDF.",
        chapterId: "patineurs",
        audience: CLUB,
      },
      {
        target: "analyse-evolution",
        title: "L'évolution des scores",
        body: "Chaque point est une compétition. La courbe montre la progression au fil de la saison.",
        chapterId: "comprendre-les-scores",
        audience: TOUS,
      },
      {
        target: "analyse-elements",
        title: "Le détail technique",
        body: "Chaque élément réalisé, sa valeur de base et la note d'exécution attribuée par les juges.",
        chapterId: "comprendre-les-scores",
        audience: TOUS,
      },
    ],
  },
  {
    pattern: "/patineurs",
    label: "la liste des patineurs",
    steps: [
      {
        target: "patineurs-liste",
        title: "Les patineurs du club",
        body: "La liste de tous les patineurs connus. Un clic sur une ligne ouvre la page d'analyse correspondante.",
        chapterId: "patineurs",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/competitions",
    label: "les compétitions",
    steps: [
      {
        target: "competitions-import",
        title: "Importer une compétition",
        body: "Collez ici l'adresse du site de la compétition : l'application récupère les feuilles de notes et en extrait les scores.",
        chapterId: "competitions",
        audience: CLUB,
      },
      {
        target: "competitions-liste",
        title: "Les compétitions importées",
        body: "Chaque compétition peut être ouverte pour voir ses résultats, ou réimportée si le site a été mis à jour.",
        chapterId: "competitions",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/club/saison",
    label: "les statistiques du club",
    steps: [
      {
        target: "club-onglets",
        title: "Saison ou compétition",
        body: "Ces onglets basculent entre la vue d'ensemble de la saison et l'analyse d'une compétition précise.",
        chapterId: "statistiques-club",
        audience: CLUB,
      },
      {
        target: "club-contenu",
        title: "Les chiffres du club",
        body: "Participations, scores moyens par catégorie et comparaisons entre patineurs sur la période choisie.",
        chapterId: "statistiques-club",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/programme",
    label: "le constructeur de programme",
    steps: [
      {
        target: "programme-contenu",
        title: "Composer un programme",
        body: "Ajoutez les éléments un à un : l'application calcule la note technique attendue et signale les écarts aux règles de la catégorie.",
        chapterId: "programme",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/entrainement",
    label: "le suivi d'entraînement",
    steps: [
      {
        target: "entrainement-contenu",
        title: "Le suivi d'entraînement",
        body: "Chaque patineur suivi dispose d'un journal : séances, ressenti, incidents et bilans de l'entraîneur.",
        chapterId: "entrainement",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/mes-patineurs",
    label: "mes patineurs",
    steps: [
      {
        target: "mes-patineurs-liste",
        title: "Vos patineurs",
        body: "Les patineurs rattachés à votre compte. Un clic ouvre la page de l'un d'eux.",
        chapterId: "mon-compte",
        audience: SKATER,
      },
      {
        target: "mes-patineurs-ajout",
        title: "Rattacher un patineur",
        body: "Si un second enfant prend une licence, rattachez-le avec son numéro de licence et sa date de naissance.",
        chapterId: "mon-compte",
        audience: SKATER,
      },
    ],
  },
  {
    pattern: "/profil",
    label: "mon compte",
    steps: [
      {
        target: "profil-contenu",
        title: "Votre compte",
        body: "Changez ici votre mot de passe et choisissez si vous souhaitez recevoir des notifications par courriel.",
        chapterId: "mon-compte",
        audience: TOUS,
      },
    ],
  },
  {
    pattern: "/",
    label: "le tableau de bord",
    steps: [
      ...REPERES,
      {
        target: "accueil-indicateurs",
        title: "Les indicateurs de la saison",
        body: "Patineurs actifs, compétitions suivies, programmes notés et podiums, pour la saison sélectionnée.",
        chapterId: "tableau-de-bord",
        audience: CLUB,
      },
      {
        target: "accueil-saison",
        title: "Changer de saison",
        body: "Ce sélecteur rejoue toute la page sur une autre saison. Le bouton voisin exporte un rapport PDF.",
        chapterId: "tableau-de-bord",
        audience: CLUB,
      },
      {
        target: "accueil-scores",
        title: "Les meilleurs scores",
        body: "Les plus hauts totaux de la saison. Un clic mène à la compétition correspondante.",
        chapterId: "tableau-de-bord",
        audience: CLUB,
      },
    ],
  },
];
```

Le motif `/` est en dernier : `matchPath("/", "/patineurs")` ne matche pas en
React Router 6 (le motif est exact par défaut), mais l'ordre reste la garantie
la plus lisible.

Les `REPERES` apparaissent à deux endroits et à deux seulement : le jeu du
tableau de bord (point d'entrée d'un compte « club ») et celui de la page
d'analyse (point d'entrée d'un compte `skater`, qui n'atteint jamais `/`). Le
filtrage par `audience` fait que chacun ne voit que les siens.

- [ ] **Step 3: Écrire la résolution de route**

À la fin du fichier :

```ts
/** Résout la route courante dans le registre, puis filtre les étapes : par
 *  parcours, et par présence effective de la cible dans le DOM. Ce second
 *  filtre est indispensable — le tableau de bord ne rend ses indicateurs que
 *  lorsque des données existent, donc sur une installation neuve la moitié des
 *  ancres manquent. */
export function screenTourFor(
  pathname: string,
  audience: Audience
): ScreenTour | null {
  const screen = SCREEN_TOURS.find((s) => matchPath(s.pattern, pathname));
  if (!screen) return null;

  const steps = screen.steps.filter(
    (s) =>
      s.audience.includes(audience) &&
      document.querySelector(`[data-tour="${s.target}"]`) !== null
  );

  if (steps.length === 0) return null;
  return { ...screen, steps };
}

/** Le motif de route de l'écran courant, indépendamment de ses étapes : sert à
 *  mémoriser qu'un écran a été vu même quand toutes ses étapes ont été
 *  filtrées. */
export function screenPatternFor(pathname: string): string | null {
  return SCREEN_TOURS.find((s) => matchPath(s.pattern, pathname))?.pattern ?? null;
}
```

- [ ] **Step 4: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/help/tour.ts
git commit -m "feat(aide): registre des étapes du tutoriel par écran"
```

---

### Task 6 : Le contexte `HelpProvider` et le mode tutoriel

**Files:**
- Create: `frontend/src/help/HelpContext.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `useLocation()`, `api.me.updatePreferences` (Task 3), `chaptersFor` / `Chapter` / `Audience` (Task 4), `screenTourFor` / `screenPatternFor` / `TourStep` (Task 5).
- Produits : `HelpProvider` (props `{ passwordModalOpen: boolean; children: ReactNode }`) et `useHelp()` renvoyant :

```ts
{
  audience: Audience;
  chapters: Chapter[];
  docChapterId: string | null;
  openDoc: (chapterId?: string) => void;
  closeDoc: () => void;
  tourMode: boolean;            // le mode persistant est-il actif ?
  startTour: () => void;
  endTour: () => void;          // « Terminer le tutoriel » : persiste tutorial_seen
  steps: TourStep[];            // étapes de l'écran courant, [] si overlay fermé
  stepIndex: number;
  overlayVisible: boolean;
  nextStep: () => void;
  prevStep: () => void;
  closeOverlay: () => void;     // ferme et marque l'écran vu, sans quitter le mode
  replayScreen: () => void;     // rejoue l'écran courant
  currentScreenLabel: string | null;
  hasStepsHere: boolean;
  tourSeen: boolean;
  inviteOpen: boolean;
  dismissInvite: () => void;
}
```

- [ ] **Step 1: Créer le fichier — état et dérivations**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { chaptersFor, type Audience, type Chapter } from "./content";
import { screenPatternFor, screenTourFor, type TourStep } from "./tour";

interface HelpState {
  audience: Audience;
  chapters: Chapter[];
  docChapterId: string | null;
  openDoc: (chapterId?: string) => void;
  closeDoc: () => void;
  tourMode: boolean;
  startTour: () => void;
  endTour: () => void;
  steps: TourStep[];
  stepIndex: number;
  overlayVisible: boolean;
  nextStep: () => void;
  prevStep: () => void;
  closeOverlay: () => void;
  replayScreen: () => void;
  currentScreenLabel: string | null;
  hasStepsHere: boolean;
  tourSeen: boolean;
  inviteOpen: boolean;
  dismissInvite: () => void;
}

const HelpContext = createContext<HelpState | null>(null);

const INVITE_DISMISSED_KEY = "tutorial_invite_dismissed";
const SCREENS_SEEN_KEY = "tutorial_screens_seen";
const TOUR_MODE_KEY = "tutorial_mode_active";

function readSeenScreens(): string[] {
  try {
    const raw = localStorage.getItem(SCREENS_SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeSeenScreens(patterns: string[]) {
  try {
    localStorage.setItem(SCREENS_SEEN_KEY, JSON.stringify(patterns));
  } catch {
    // Navigation privée ou stockage plein : le tutoriel refera l'écran au
    // rechargement, ce qui est sans gravité.
  }
}
```

- [ ] **Step 2: Écrire le corps du provider**

```tsx
export function HelpProvider({
  passwordModalOpen,
  children,
}: {
  /** Le modal de mot de passe est-il à l'écran ? L'invite du tutoriel attend
   *  qu'il soit fermé, quelle qu'en soit l'issue : un compte créé par demande
   *  arrive justement avec un mot de passe temporaire ET une première
   *  connexion. */
  passwordModalOpen: boolean;
  children: ReactNode;
}) {
  const { user, updateUser } = useAuth();
  const { pathname } = useLocation();

  const [docChapterId, setDocChapterId] = useState<string | null>(null);
  const [tourMode, setTourMode] = useState(
    () => sessionStorage.getItem(TOUR_MODE_KEY) === "true"
  );
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [inviteDismissed, setInviteDismissed] = useState(
    () => sessionStorage.getItem(INVITE_DISMISSED_KEY) === "true"
  );

  const audience: Audience = user?.role === "skater" ? "skater" : "club";
  const chapters = useMemo(() => chaptersFor(audience), [audience]);
  const tourSeen = user?.tutorial_seen === true;

  const openDoc = useCallback(
    (chapterId?: string) => setDocChapterId(chapterId ?? chapters[0]?.id ?? null),
    [chapters]
  );
  const closeDoc = useCallback(() => setDocChapterId(null), []);

  const markScreenSeen = useCallback((pattern: string) => {
    const seen = readSeenScreens();
    if (!seen.includes(pattern)) writeSeenScreens([...seen, pattern]);
  }, []);

  /** Persiste « vu » et rafraîchit l'utilisateur en mémoire, pour que le bouton
   *  de démarrage disparaisse sans rechargement. L'échec réseau est silencieux :
   *  le tutoriel a bien été suivi, seul l'état distant manque. */
  const markSeen = useCallback(async () => {
    if (!user || user.tutorial_seen) return;
    updateUser({ ...user, tutorial_seen: true });
    try {
      await api.me.updatePreferences({ tutorial_seen: true });
    } catch {
      // Sans effet visible : l'invite reviendra à la prochaine session.
    }
  }, [user, updateUser]);

  const startTour = useCallback(() => {
    // Remise à zéro au DÉMARRAGE, pas à la fin : un tutoriel relancé des mois
    // plus tard doit être complet, pas muet.
    writeSeenScreens([]);
    sessionStorage.setItem(TOUR_MODE_KEY, "true");
    setTourMode(true);
    setDocChapterId(null);
    setSteps([]);
    setStepIndex(0);
  }, []);

  const endTour = useCallback(() => {
    sessionStorage.removeItem(TOUR_MODE_KEY);
    setTourMode(false);
    setSteps([]);
    setStepIndex(0);
    void markSeen();
  }, [markSeen]);

  const closeOverlay = useCallback(() => {
    const pattern = screenPatternFor(pathname);
    if (pattern) markScreenSeen(pattern);
    setSteps([]);
    setStepIndex(0);
  }, [pathname, markScreenSeen]);

  const replayScreen = useCallback(() => {
    const screen = screenTourFor(pathname, audience);
    if (!screen) return;
    setSteps(screen.steps);
    setStepIndex(0);
  }, [pathname, audience]);

  const nextStep = useCallback(
    () => setStepIndex((i) => (i + 1 < steps.length ? i + 1 : i)),
    [steps.length]
  );
  const prevStep = useCallback(
    () => setStepIndex((i) => (i > 0 ? i - 1 : i)),
    []
  );

  const dismissInvite = useCallback(() => {
    sessionStorage.setItem(INVITE_DISMISSED_KEY, "true");
    setInviteDismissed(true);
  }, []);

  return null; // remplacé à l'étape suivante
}
```

- [ ] **Step 3: Ajouter le déclenchement au changement de route**

Remplacer le `return null;` provisoire par l'effet de déclenchement puis le
provider. L'effet est le cœur du mode : il réagit à la route, jamais l'inverse.

```tsx
  // Déclenchement à l'arrivée sur un écran. Le délai laisse la page monter et
  // ses requêtes se résoudre : sans lui, les ancres d'un écran qui charge ses
  // données seraient absentes du DOM et toutes les étapes seraient filtrées.
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!tourMode) {
      lastHandled.current = null;
      return;
    }
    const pattern = screenPatternFor(pathname);
    if (!pattern || lastHandled.current === pattern) return;
    if (readSeenScreens().includes(pattern)) {
      lastHandled.current = pattern;
      return;
    }

    const timer = setTimeout(() => {
      const screen = screenTourFor(pathname, audience);
      lastHandled.current = pattern;
      if (!screen) {
        // Aucune étape affichable ici (données absentes, mauvais parcours) :
        // marquer vu plutôt que d'encadrer le vide.
        markScreenSeen(pattern);
        return;
      }
      setSteps(screen.steps);
      setStepIndex(0);
    }, 400);

    return () => clearTimeout(timer);
  }, [tourMode, pathname, audience, markScreenSeen]);

  const overlayVisible = tourMode && steps.length > 0;
  const currentScreen = useMemo(
    () => (tourMode ? screenPatternFor(pathname) : null),
    [tourMode, pathname]
  );
  const currentScreenLabel = useMemo(() => {
    if (!currentScreen) return null;
    return screenTourFor(pathname, audience)?.label ?? null;
  }, [currentScreen, pathname, audience]);

  const inviteOpen =
    !passwordModalOpen && !tourSeen && !inviteDismissed && !tourMode;

  const value: HelpState = {
    audience,
    chapters,
    docChapterId,
    openDoc,
    closeDoc,
    tourMode,
    startTour,
    endTour,
    steps,
    stepIndex,
    overlayVisible,
    nextStep,
    prevStep,
    closeOverlay,
    replayScreen,
    currentScreenLabel,
    hasStepsHere: currentScreenLabel !== null,
    tourSeen,
    inviteOpen,
    dismissInvite,
  };

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp(): HelpState {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within HelpProvider");
  return ctx;
}
```

Le mode est mémorisé en `sessionStorage` (`TOUR_MODE_KEY`) et non en
`localStorage` : un tutoriel doit survivre à un rechargement de page, pas à la
fermeture du navigateur.

- [ ] **Step 4: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/help/HelpContext.tsx
git commit -m "feat(aide): contexte et mode tutoriel persistant"
```

---

### Task 7 : Panneau de documentation et menu « ? »

**Files:**
- Create: `frontend/src/help/DocPanel.tsx`
- Create: `frontend/src/help/HelpMenu.tsx`

**Interfaces:**
- Consumes: `useHelp()` (Task 6).
- Produits : `DocPanel` et `HelpMenu`, sans props.

- [ ] **Step 1: Créer `DocPanel.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { useHelp } from "./HelpContext";

export default function DocPanel() {
  const { chapters, docChapterId, openDoc, closeDoc } = useHelp();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const index = chapters.findIndex((c) => c.id === docChapterId);
  const chapter = index >= 0 ? chapters[index] : null;

  useEffect(() => {
    if (!chapter) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDoc();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [chapter, closeDoc]);

  // Le panneau prend le focus à l'ouverture, et le contenu repart du haut à
  // chaque changement de chapitre.
  useEffect(() => {
    if (chapter) {
      panelRef.current?.focus();
      bodyRef.current?.scrollTo(0, 0);
    }
  }, [chapter]);

  if (!chapter) return null;

  const previous = index > 0 ? chapters[index - 1] : null;
  const next = index < chapters.length - 1 ? chapters[index + 1] : null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-on-surface/40" onClick={closeDoc} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Documentation : ${chapter.title}`}
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-surface-container-lowest shadow-2xl flex flex-col focus:outline-none"
      >
        <header className="flex items-center gap-3 px-5 py-4 bg-surface-container-low shrink-0">
          <span className="material-symbols-outlined text-primary text-xl">
            {chapter.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-headline font-bold text-on-surface text-base truncate">
              {chapter.title}
            </h2>
            {chapter.adminOnly && (
              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">
                Administrateur
              </span>
            )}
          </div>
          <button
            onClick={closeDoc}
            aria-label="Fermer la documentation"
            className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4">
          {chapter.body()}
        </div>

        <nav className="flex items-center justify-between gap-2 px-5 py-3 bg-surface-container-low shrink-0">
          {previous ? (
            <button
              onClick={() => openDoc(previous.id)}
              className="flex items-center gap-1 text-xs text-primary hover:underline min-w-0"
            >
              <span className="material-symbols-outlined text-base shrink-0">
                chevron_left
              </span>
              <span className="truncate">{previous.title}</span>
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button
              onClick={() => openDoc(next.id)}
              className="flex items-center gap-1 text-xs text-primary hover:underline min-w-0"
            >
              <span className="truncate">{next.title}</span>
              <span className="material-symbols-outlined text-base shrink-0">
                chevron_right
              </span>
            </button>
          )}
        </nav>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Créer `HelpMenu.tsx`**

Le pattern de fermeture au clic extérieur reprend
`frontend/src/components/NotificationBell.tsx:39-47`.

```tsx
import { useEffect, useRef, useState } from "react";
import { useHelp } from "./HelpContext";

export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { chapters, openDoc, startTour, endTour, tourMode } = useHelp();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleEsc);
    }
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef} data-tour="help-menu">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Aide"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative text-on-surface-variant hover:text-on-surface transition-colors flex items-center"
      >
        <span className="material-symbols-outlined text-2xl">help</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-80 bg-surface-container-lowest rounded-xl shadow-lg z-50 overflow-hidden"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (tourMode) endTour();
              else startTour();
            }}
            className="w-full text-left px-4 py-3 hover:bg-surface-container transition-colors flex items-center gap-3"
          >
            <span className="material-symbols-outlined text-lg text-primary shrink-0">
              {tourMode ? "stop_circle" : "play_circle"}
            </span>
            <span className="text-sm font-bold text-on-surface">
              {tourMode ? "Terminer le tutoriel" : "Démarrer le tutoriel"}
            </span>
          </button>

          <div className="bg-surface-container-low px-4 py-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Documentation
            </h3>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {chapters.map((c) => (
              <button
                key={c.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openDoc(c.id);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-surface-container transition-colors flex items-center gap-3"
              >
                <span className="material-symbols-outlined text-lg text-on-surface-variant shrink-0">
                  {c.icon}
                </span>
                <span className="text-sm text-on-surface min-w-0 flex-1 truncate">
                  {c.title}
                </span>
                {c.adminOnly && (
                  <span className="text-[9px] uppercase tracking-wider text-on-surface-variant shrink-0">
                    Admin
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/help/DocPanel.tsx frontend/src/help/HelpMenu.tsx
git commit -m "feat(aide): menu ? et panneau de documentation"
```

---

### Task 8 : La superposition d'un écran

**Files:**
- Create: `frontend/src/help/TourOverlay.tsx`

**Interfaces:**
- Consumes: `useHelp()` (Task 6).
- Produits : `TourOverlay`, sans props.

- [ ] **Step 1: Créer le fichier**

Le masque est fait de quatre rectangles autour de la cible plutôt que d'un
`box-shadow` géant : plus fiable à positionner, et la cible reste cliquable.

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHelp } from "./HelpContext";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;       // marge du surlignage autour de la cible
const BUBBLE_W = 320;
const GAP = 12;      // écart entre la cible et la bulle

export default function TourOverlay() {
  const {
    overlayVisible,
    steps,
    stepIndex,
    nextStep,
    prevStep,
    closeOverlay,
    openDoc,
    chapters,
  } = useHelp();
  const [rect, setRect] = useState<Rect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const step = overlayVisible ? steps[stepIndex] : null;

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  // Mesure avant peinture pour éviter un cadre au mauvais endroit sur une
  // frame, après avoir amené la cible dans la vue.
  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
  }, [step, measure]);

  useEffect(() => {
    if (!overlayVisible) return;
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [overlayVisible, measure]);

  // Le focus part sur la bulle à chaque étape : le lecteur d'écran annonce le
  // nouveau contenu, et Tab reste dans la bulle.
  useEffect(() => {
    if (overlayVisible) bubbleRef.current?.focus();
  }, [overlayVisible, stepIndex]);

  // Échap ferme l'explication de cet écran — sans quitter le mode tutoriel.
  useEffect(() => {
    if (!overlayVisible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [overlayVisible, closeOverlay]);

  if (!overlayVisible || !step) return null;

  const isLast = stepIndex === steps.length - 1;
  const hasChapter =
    step.chapterId !== undefined &&
    chapters.some((c) => c.id === step.chapterId);

  // Cible introuvable au moment du rendu : bulle centrée, sans surlignage.
  const box = rect ?? {
    top: window.innerHeight / 2,
    left: window.innerWidth / 2,
    width: 0,
    height: 0,
  };

  const below = window.innerHeight - (box.top + box.height) > 220;
  const bubbleTop = below ? box.top + box.height + GAP : undefined;
  const bubbleBottom = below ? undefined : window.innerHeight - box.top + GAP;
  const bubbleLeft = Math.min(
    Math.max(GAP, box.left + box.width / 2 - BUBBLE_W / 2),
    window.innerWidth - BUBBLE_W - GAP
  );

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Masque en quatre rectangles autour de la cible. */}
      <div aria-hidden="true" onClick={closeOverlay}>
        <div
          className="absolute bg-on-surface/60 left-0 right-0 top-0"
          style={{ height: Math.max(0, box.top - PAD) }}
        />
        <div
          className="absolute bg-on-surface/60 left-0 right-0 bottom-0"
          style={{ top: box.top + box.height + PAD }}
        />
        <div
          className="absolute bg-on-surface/60 left-0"
          style={{
            top: box.top - PAD,
            height: box.height + PAD * 2,
            width: Math.max(0, box.left - PAD),
          }}
        />
        <div
          className="absolute bg-on-surface/60 right-0"
          style={{
            top: box.top - PAD,
            height: box.height + PAD * 2,
            left: box.left + box.width + PAD,
          }}
        />
      </div>

      {rect && (
        <div
          aria-hidden="true"
          className="absolute rounded-xl ring-2 ring-primary pointer-events-none"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        />
      )}

      <div
        ref={bubbleRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Explication de l'écran"
        className="absolute bg-surface rounded-2xl shadow-2xl p-4 focus:outline-none"
        style={{
          width: BUBBLE_W,
          top: bubbleTop,
          bottom: bubbleBottom,
          left: bubbleLeft,
        }}
      >
        <div aria-live="polite">
          <h2 className="font-headline font-bold text-on-surface text-sm mb-1">
            {step.title}
          </h2>
          <p className="text-sm text-on-surface-variant mb-3">{step.body}</p>
        </div>

        {hasChapter && (
          <button
            onClick={() => {
              closeOverlay();
              openDoc(step.chapterId);
            }}
            className="text-xs text-primary hover:underline mb-3 inline-flex items-center gap-1"
          >
            En savoir plus
            <span className="material-symbols-outlined text-sm">
              arrow_forward
            </span>
          </button>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-on-surface-variant font-mono">
            {stepIndex + 1} / {steps.length}
          </span>
          <div className="flex-1" />
          {stepIndex > 0 && (
            <button
              onClick={prevStep}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              Précédent
            </button>
          )}
          <button
            onClick={isLast ? closeOverlay : nextStep}
            className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold"
          >
            {isLast ? "Terminer cet écran" : "Suivant"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Noter qu'il n'y a plus de « Passer le tutoriel » ici : quitter le tutoriel est
l'affaire du bandeau, qui est toujours visible. La bulle ne gère que l'écran
courant.

- [ ] **Step 2: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/help/TourOverlay.tsx
git commit -m "feat(aide): superposition explicative par écran"
```

---

### Task 9 : Bandeau et pastille de rappel

**Files:**
- Create: `frontend/src/help/TourBanner.tsx`
- Create: `frontend/src/help/TourReminder.tsx`

**Interfaces:**
- Consumes: `useHelp()` (Task 6).
- Produits : `TourBanner` et `TourReminder`, sans props.

- [ ] **Step 1: Créer `TourBanner.tsx`**

```tsx
import { useHelp } from "./HelpContext";

/** Rappelle en permanence que le mode tutoriel est actif, et porte le seul
 *  bouton qui en sort. Placé dans le flux sous la barre supérieure : un bandeau
 *  qui recouvrirait l'écran qu'il prétend expliquer serait absurde. */
export default function TourBanner() {
  const { tourMode, endTour } = useHelp();

  if (!tourMode) return null;

  return (
    <div
      role="status"
      className="sticky top-[72px] z-20 bg-primary text-on-primary px-4 lg:px-8 py-2.5 flex items-center gap-3"
    >
      <span className="material-symbols-outlined text-xl shrink-0">school</span>
      <p className="text-xs font-medium flex-1 min-w-0 hidden sm:block">
        Mode tutoriel — les écrans que vous ouvrez vous sont expliqués.
      </p>
      <p className="text-xs font-medium flex-1 min-w-0 sm:hidden">
        Mode tutoriel
      </p>
      <button
        onClick={endTour}
        className="bg-on-primary text-primary rounded-xl px-3 py-1.5 text-xs font-bold shrink-0"
      >
        Terminer le tutoriel
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Créer `TourReminder.tsx`**

```tsx
import { useHelp } from "./HelpContext";

/** Visible quand le mode est actif mais qu'aucune explication n'est à l'écran :
 *  dit où l'on en est, et permet de rejouer un écran cliqué trop vite. */
export default function TourReminder() {
  const { tourMode, overlayVisible, hasStepsHere, replayScreen, currentScreenLabel } =
    useHelp();

  if (!tourMode || overlayVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[55] bg-surface-container-lowest rounded-2xl shadow-lg px-4 py-3 max-w-xs">
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-primary text-lg">
          school
        </span>
        <span className="text-xs font-bold text-on-surface">Tutoriel actif</span>
      </div>
      <p className="text-xs text-on-surface-variant">
        Ouvrez une autre section pour la découvrir.
      </p>
      {hasStepsHere && (
        <button
          onClick={replayScreen}
          className="text-xs text-primary hover:underline mt-2 inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm">replay</span>
          Revoir {currentScreenLabel}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/help/TourBanner.tsx frontend/src/help/TourReminder.tsx
git commit -m "feat(aide): bandeau du mode tutoriel et pastille de rappel"
```

---

### Task 10 : Modal d'invite et bouton de démarrage

**Files:**
- Create: `frontend/src/help/TourInviteModal.tsx`
- Create: `frontend/src/help/StartTourButton.tsx`

**Interfaces:**
- Consumes: `useHelp()` (Task 6).
- Produits : `TourInviteModal` et `StartTourButton`, sans props.

- [ ] **Step 1: Créer `TourInviteModal.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { useHelp } from "./HelpContext";

export default function TourInviteModal() {
  const { inviteOpen, startTour, dismissInvite } = useHelp();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inviteOpen) return;
    ref.current?.focus();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissInvite();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [inviteOpen, dismissInvite]);

  if (!inviteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-on-surface/40" onClick={dismissInvite} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Découvrir l'application"
        className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6 focus:outline-none"
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="material-symbols-outlined text-primary text-2xl">
            explore
          </span>
          <h2 className="font-headline font-bold text-on-surface text-base">
            Découvrir l'application
          </h2>
        </div>
        <p className="text-sm text-on-surface-variant mb-5">
          En mode tutoriel, chaque écran que vous ouvrez vous est expliqué. Vous
          naviguez librement et vous y mettez fin quand vous le souhaitez, depuis
          le bandeau en haut de page.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={dismissInvite}
            className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            Plus tard
          </button>
          <div className="flex-1" />
          <button
            onClick={() => {
              dismissInvite();
              startTour();
            }}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold inline-flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">play_circle</span>
            Démarrer le tutoriel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Créer `StartTourButton.tsx`**

```tsx
import { useHelp } from "./HelpContext";

/** Visible tant que le tutoriel n'a pas été suivi et que le mode n'est pas
 *  actif (le bandeau prend alors le relais). Une fois le tutoriel terminé, il
 *  reste accessible depuis le menu « ? ». */
export default function StartTourButton() {
  const { tourSeen, tourMode, startTour } = useHelp();

  if (tourSeen || tourMode) return null;

  return (
    <button
      onClick={startTour}
      className="bg-primary text-on-primary rounded-xl px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
      title="Démarrer le tutoriel"
    >
      <span className="material-symbols-outlined text-lg">play_circle</span>
      <span className="hidden sm:inline">Tutoriel</span>
    </button>
  );
}
```

- [ ] **Step 3: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/help/TourInviteModal.tsx frontend/src/help/StartTourButton.tsx
git commit -m "feat(aide): modal d'invite et bouton de démarrage"
```

---

### Task 11 : Câblage dans `App.tsx` et ancres du shell

**Files:**
- Modify: `frontend/src/App.tsx` — imports, provider, barre supérieure, bandeau, couches flottantes, ancres `sidebar-nav`, `notifications`, `user-account`

**Interfaces:**
- Consumes: tous les composants des tâches 6 à 10.
- Produits : le mode tutoriel opérationnel sur le shell ; les ancres des pages viennent en Task 12.

- [ ] **Step 1: Ajouter les imports**

Après `import NotificationBell from "./components/NotificationBell";` :

```tsx
import { HelpProvider } from "./help/HelpContext";
import HelpMenu from "./help/HelpMenu";
import DocPanel from "./help/DocPanel";
import TourOverlay from "./help/TourOverlay";
import TourBanner from "./help/TourBanner";
import TourReminder from "./help/TourReminder";
import TourInviteModal from "./help/TourInviteModal";
import StartTourButton from "./help/StartTourButton";
```

- [ ] **Step 2: Monter le provider**

Le `return` de `AuthenticatedLayout` commence par `<JobProvider>` suivi de
`<div className="flex min-h-screen">`. Insérer `HelpProvider` entre les deux :

```tsx
    <JobProvider>
    <HelpProvider passwordModalOpen={showPasswordModal}>
    <div className="flex min-h-screen">
```

Et remplacer la fin du composant :

```tsx
      {showPasswordModal && (
        <ForcePasswordModal onClose={dismissPasswordModal} />
      )}
      <DocPanel />
      <TourOverlay />
      <TourReminder />
      <TourInviteModal />
    </HelpProvider>
    </JobProvider>
```

`showPasswordModal` est déjà calculé plus haut : c'est cette même valeur qui
pilote les deux modals, ce qui garantit qu'ils ne coexistent jamais.

- [ ] **Step 3: Compléter la barre supérieure et poser le bandeau**

Remplacer le bloc `<header>` et ajouter `<TourBanner />` juste après :

```tsx
        <header className="sticky top-0 bg-surface/70 backdrop-blur-xl z-30 shadow-sm flex items-center gap-3 px-4 lg:px-8 py-4">
          <button
            className="lg:hidden text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <span className="material-symbols-outlined text-2xl">menu</span>
          </button>
          <h1 className="font-headline font-bold text-on-surface text-xl truncate flex-1">
            {pageTitle}
          </h1>
          <StartTourButton />
          <HelpMenu />
          <div data-tour="notifications">
            <NotificationBell />
          </div>
        </header>
        <TourBanner />
```

`NotificationBell` gère son propre positionnement relatif ; l'envelopper d'un
`div` porteur de l'attribut évite de modifier ce composant.

- [ ] **Step 4: Poser les ancres de la sidebar**

Trois `<nav className="flex-1 py-2">` existent (`SkaterNav`, la nav `coach`, la
nav par défaut). Ajouter `data-tour="sidebar-nav"` **aux trois** :

```tsx
<nav data-tour="sidebar-nav" className="flex-1 py-2">
```

- [ ] **Step 5: Poser l'ancre du bloc compte**

Le bas de la sidebar a deux rendus selon `collapsed`. Ajouter
`data-tour="user-account"` sur le conteneur de chacun :

```tsx
            <div data-tour="user-account" className="flex flex-col items-center gap-1 py-2">
```

et

```tsx
            <div data-tour="user-account" className="flex items-center gap-2 px-4 py-2">
```

Un seul des deux est monté à la fois : pas d'ambiguïté pour `querySelector`.

- [ ] **Step 6: Vérifier la compilation et le build**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit && PATH="/opt/homebrew/bin:$PATH" npm run build
```

- [ ] **Step 7: Contrôler la position du bandeau**

Le bandeau utilise `top-[72px]`, qui suppose une barre supérieure d'environ
72 px (`py-4` + contenu). Lancer l'app, activer le mode tutoriel, et vérifier
que le bandeau se colle bien sous la barre sans chevauchement ni interstice.
Ajuster la valeur si nécessaire et noter la valeur retenue.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(aide): câblage du mode tutoriel dans le shell"
```

---

### Task 12 : Ancres `data-tour` dans les pages couvertes

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx` — `accueil-saison`, `accueil-indicateurs`, `accueil-scores`
- Modify: `frontend/src/pages/SkaterBrowserPage.tsx` — `patineurs-liste`
- Modify: `frontend/src/pages/SkaterAnalyticsPage.tsx` — `analyse-entete`, `analyse-evolution`, `analyse-elements`
- Modify: `frontend/src/pages/CompetitionsPage.tsx` — `competitions-import`, `competitions-liste`
- Modify: `frontend/src/pages/StatsPage.tsx` — `club-contenu`
- Modify: `frontend/src/components/ClubTabBar.tsx` — `club-onglets`
- Modify: `frontend/src/pages/ProgramBuilderPage.tsx` — `programme-contenu`
- Modify: `frontend/src/pages/TrainingPage.tsx` — `entrainement-contenu`
- Modify: `frontend/src/pages/MySkatersPage.tsx` — `mes-patineurs-liste`, `mes-patineurs-ajout`
- Modify: `frontend/src/pages/ProfilePage.tsx` — `profil-contenu`

**Interfaces:**
- Consumes: les `target` déclarés dans `tour.ts` (Task 5).
- Produits : les 16 ancres de page que le registre attend. Les 4 ancres du
  shell — `sidebar-nav`, `notifications`, `user-account` (Task 11) et
  `help-menu` (porté par `HelpMenu.tsx`) — sont déjà en place.

**Règle générale.** Chaque ancre se pose sur le conteneur **le plus englobant**
de ce que l'étape décrit, jamais sur un élément conditionnel isolé : un
surlignage doit encadrer un bloc identifiable. Aucune autre modification de ces
pages n'est autorisée dans cette tâche — uniquement l'ajout d'attributs.

- [ ] **Step 1: `HomePage.tsx`**

Trois ancres, sur les blocs identifiés dans le rendu de `HomePage` :

- `accueil-saison` : le `<div className="flex items-center gap-3">` de l'en-tête
  qui contient le `<select>` de saison et le bouton « Rapport de saison ».
- `accueil-indicateurs` : le `<div className="grid grid-cols-1 md:grid-cols-4 gap-6">`
  qui contient les quatre `<KpiCard>`.
- `accueil-scores` : le `<div className="lg:col-span-2">` qui contient
  `<TopScoresTable>` et `<MostImprovedCards>`.

Exemple pour le premier :

```tsx
        <div data-tour="accueil-saison" className="flex items-center gap-3">
```

Les deux derniers ne sont rendus que si `dashboard` existe : sur une base vide,
ils sont absents et les étapes correspondantes seront filtrées — comportement
voulu.

- [ ] **Step 2: `SkaterBrowserPage.tsx`**

`patineurs-liste` sur le conteneur du tableau
(`<div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-x-auto">`,
vers la ligne 73) :

```tsx
      <div data-tour="patineurs-liste" className="bg-surface-container-lowest rounded-xl shadow-sm overflow-x-auto">
```

- [ ] **Step 3: `SkaterAnalyticsPage.tsx`**

Lire la page et poser trois ancres :

- `analyse-entete` : le bloc d'en-tête portant le nom du patineur et le
  sélecteur de saison.
- `analyse-evolution` : le conteneur du graphique d'évolution des scores
  (`<ScoreChart>` ou son bloc parent).
- `analyse-elements` : le conteneur du détail des éléments techniques.

Si la page structure ces zones différemment, poser l'ancre sur le conteneur
le plus proche qui englobe la zone décrite, et noter le choix dans le message
de commit.

- [ ] **Step 4: `CompetitionsPage.tsx`**

- `competitions-import` : le formulaire d'import
  (`<form className="bg-surface-container-lowest rounded-xl shadow-sm p-6 mb-6">`,
  vers la ligne 227).
- `competitions-liste` : le conteneur de la liste des compétitions (le bloc qui
  enveloppe les cartes vers la ligne 488).

Le formulaire d'import n'est rendu que pour un administrateur : un `coach` ou
un `reader` verra l'étape filtrée, ce qui est le comportement voulu.

- [ ] **Step 5: `StatsPage.tsx` et `ClubTabBar.tsx`**

- `club-onglets` : dans `ClubTabBar.tsx`, sur le conteneur racine des onglets.
- `club-contenu` : dans `StatsPage.tsx`, sur le premier bloc de contenu
  (`<div className="bg-surface-container-lowest rounded-xl shadow-sm p-6">`,
  vers la ligne 314).

- [ ] **Step 6: `ProgramBuilderPage.tsx`, `TrainingPage.tsx`, `ProfilePage.tsx`**

Une ancre chacune, sur le conteneur principal du contenu de la page :
`programme-contenu`, `entrainement-contenu`, `profil-contenu`. Viser le
conteneur qui englobe le contenu utile, sous l'en-tête de page.

- [ ] **Step 7: `MySkatersPage.tsx`**

- `mes-patineurs-liste` : le conteneur de la liste des patineurs rattachés (le
  bloc qui enveloppe les cartes, vers la ligne 175).
- `mes-patineurs-ajout` : le bloc du formulaire de rattachement
  (`<... className="bg-surface-container rounded-xl p-5 max-w-md">`, vers la
  ligne 61).

- [ ] **Step 8: Vérifier que les 20 ancres sont posées**

```bash
grep -rho 'data-tour="[a-z-]*"' frontend/src | sort -u
```

Attendu, 20 valeurs distinctes : `accueil-indicateurs`, `accueil-saison`,
`accueil-scores`, `analyse-elements`, `analyse-entete`, `analyse-evolution`,
`club-contenu`, `club-onglets`, `competitions-import`, `competitions-liste`,
`entrainement-contenu`, `help-menu`, `mes-patineurs-ajout`,
`mes-patineurs-liste`, `notifications`, `patineurs-liste`,
`profil-contenu`, `programme-contenu`, `sidebar-nav`, `user-account`.

(16 ancres de page + 4 du shell.) Comparer cette liste aux `target` présents
dans `tour.ts` : toute valeur d'un côté sans correspondance de l'autre est une
erreur à corriger avant de committer.

- [ ] **Step 9: Vérifier la compilation et le build**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit && PATH="/opt/homebrew/bin:$PATH" npm run build
```

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages frontend/src/components/ClubTabBar.tsx
git commit -m "feat(aide): ancres du tutoriel dans les écrans couverts"
```

---

### Task 13 : Vérification manuelle et journal

**Files:**
- Create: `docs/superpowers/plans/2026-09-13-documentation-integree-verification.md`

**Interfaces:**
- Consumes: l'application complète (Tasks 1–12).
- Produits : le constat de vérification.

- [ ] **Step 1: Lancer la pile**

```bash
make dev-backend    # dans un terminal
make dev-frontend   # dans un autre
```

- [ ] **Step 2: Remettre l'état à zéro**

```bash
docker compose exec backend python -c "
import asyncio
from sqlalchemy import text
from app.database import engine
async def main():
    async with engine.begin() as c:
        await c.execute(text('UPDATE users SET tutorial_seen_at = NULL'))
asyncio.run(main())
"
```

Si la pile tourne hors Docker, viser directement le fichier SQLite. Vider
ensuite `sessionStorage` et `localStorage` (onglet privé, ou
`sessionStorage.clear(); localStorage.clear()` en console).

- [ ] **Step 3: Vérifier le parcours « club » (compte admin)**

1. Le modal d'invite s'affiche après connexion.
2. « Plus tard » le ferme ; le bouton « Tutoriel » est visible dans la barre.
3. Le bouton active le mode : le bandeau apparaît sous la barre supérieure.
4. Le mini-parcours du tableau de bord démarre ; le premier surlignage encadre
   le menu de gauche.
5. « Suivant » parcourt les étapes ; le compteur est cohérent.
6. « Terminer cet écran » referme l'overlay ; la pastille « Tutoriel actif »
   apparaît en bas à droite.
7. Naviguer vers **Patineurs** : un nouvel overlay démarre, propre à cet écran.
8. Faire de même pour Compétitions, Club, Programme, Entraînement (si activé)
   et une page d'analyse patineur : chacun a son overlay.
9. Revenir au tableau de bord : **aucun overlay ne redémarre** (écran déjà vu),
   la pastille propose « Revoir le tableau de bord ».
10. Cliquer « Revoir » : le mini-parcours rejoue.
11. Recharger la page en cours de mode : le bandeau est toujours là, et l'écran
    courant n'est pas rejoué s'il avait été vu.
12. « Terminer le tutoriel » : bandeau et pastille disparaissent, le bouton
    « Tutoriel » de la barre ne revient pas.
13. Recharger : ni invite, ni bandeau, ni bouton.

- [ ] **Step 4: Vérifier le parcours « patineur »**

Avec un compte de rôle `skater` (état remis à zéro) :

1. Le menu « ? » ne liste que les chapitres du parcours patineur — aucune
   mention de l'import de compétitions ni de l'administration.
2. Le mode démarre sur la page d'analyse du patineur, avec les repères du shell
   adaptés (« Votre espace ») puis les étapes de la page.
3. Naviguer vers « Mes patineurs » (si plusieurs patineurs) et « Mon compte » :
   chacun a son overlay.
4. Aucune étape ne surligne le vide.

- [ ] **Step 5: Vérifier l'enchaînement avec le modal de mot de passe**

Forcer le changement de mot de passe sur un compte de test depuis
l'administration, puis s'y connecter (`sessionStorage` vidé) :

1. Le modal de mot de passe s'affiche **seul**.
2. Le fermer par la croix sans changer le mot de passe : l'invite du tutoriel
   apparaît immédiatement.
3. Recommencer en changeant réellement le mot de passe : l'invite apparaît de
   même après la fermeture.

- [ ] **Step 6: Vérifier le cas « base vide »**

Sur une base sans compétition importée, activer le mode et ouvrir le tableau de
bord : les étapes dont les ancres n'existent pas (indicateurs, meilleurs
scores) doivent être **absentes du compteur**, sans cadre autour du vide. Si
toutes les étapes de l'écran tombent, aucun overlay ne s'affiche et l'écran est
marqué vu.

- [ ] **Step 7: Vérifier le responsive**

Sous 640 px : le bouton « Tutoriel » n'affiche que son icône, le bandeau garde
son bouton « Terminer », le panneau de documentation occupe toute la largeur,
la bulle reste entièrement dans l'écran à chaque étape, et la pastille ne
recouvre pas un élément essentiel.

- [ ] **Step 8: Consigner le constat**

Écrire `docs/superpowers/plans/2026-09-13-documentation-integree-verification.md`
avec le résultat observé pour chaque point des étapes 3 à 7. Noter
explicitement tout écart plutôt que de le corriger en silence.

- [ ] **Step 9: Lancer la suite backend une dernière fois**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest -q
```

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-documentation-integree-verification.md
git commit -m "docs(aide): constat de vérification manuelle"
```

---

## Auto-revue

**Couverture du spec.** Mode persistant et cycle de vie (Task 6) ; registre par
route avec `matchPath` (Task 5) ; écrans couverts, 7 club + 3 patineur
(Tasks 5, 12) ; bandeau et « Terminer le tutoriel » (Task 9) ; pastille et
« Revoir cet écran » (Task 9) ; écrans vus en `localStorage` vidés au démarrage
(Task 6, Step 2) ; filtrage par audience et par présence DOM (Task 5, Step 4) ;
illustrations JSX (Task 4) ; persistance `tutorial_seen_at` (Tasks 1–3) ;
séquence après le modal mot de passe (Tasks 6, 10, 11) ; accessibilité
(Tasks 7–9) ; les 4 tests backend (Tasks 1–2) ; vérification manuelle
(Task 13).

**Cohérence des types.** `Audience` est défini une fois dans `content.tsx`,
importé par `tour.ts` et `HelpContext.tsx`. `Chapter.id` alimente
`TourStep.chapterId`, `openDoc()` et `chapters.findIndex()`. `screenTourFor` et
`screenPatternFor` sont nommés et appelés de façon identique dans le contexte.
Les 20 valeurs de `data-tour` sont listées en Task 12 Step 8 et confrontées aux
`target` de `tour.ts`.

**Points que l'exécutant devra trancher sur pièces.** Trois ancres de
`SkaterAnalyticsPage` et trois conteneurs principaux (`ProgramBuilderPage`,
`TrainingPage`, `ProfilePage`) sont décrits par leur rôle plutôt que par une
ligne exacte : ces pages n'ont pas été lues en détail pendant la rédaction. La
Task 12 donne la règle de choix (conteneur le plus englobant de ce que l'étape
décrit) et demande de noter le choix retenu.

**Valeur à confirmer à l'exécution.** Le `top-[72px]` du bandeau dépend de la
hauteur réelle de la barre supérieure ; la Task 11 Step 7 impose de la vérifier
à l'écran et d'ajuster.

**Conformité au spec.** Les 4 tests backend et les 10 fichiers frontend du spec
sont couverts un pour un, `TourBanner.tsx` et `TourReminder.tsx` compris.
