# Documentation intégrée et tutoriel interactif — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un menu « ? » ouvrant une documentation illustrée, et un tutoriel en superposition proposé à la première connexion après le modal de changement de mot de passe.

**Architecture:** Un contexte React `HelpProvider` monté dans `AuthenticatedLayout` possède tout l'état (panneau de doc, tour actif, invite due) et l'expose aux composants visuels. Le tour cible des attributs `data-tour` posés dans `App.tsx` et saute les étapes dont la cible est absente du DOM, ce qui absorbe les différences de rôle. L'état « tutoriel vu » est persisté en base sur `users.tutorial_seen_at` via le `PATCH /api/me/preferences` existant.

**Tech Stack:** React 19 + TypeScript + Tailwind CSS (aucune bibliothèque de composants), Litestar + SQLAlchemy async + SQLite, pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-09-13-documentation-integree-design.md`

## Global Constraints

- **Tout le texte d'interface est en français.** Sans exception, y compris les libellés `aria-label` et les messages d'erreur.
- **Tailwind CSS uniquement**, aucune bibliothèque de composants, aucune dépendance npm nouvelle.
- **Pas de bordure pour le sectionnement** — utiliser la superposition de surfaces (`surface`, `surface-container-low`, `surface-container`, `surface-container-lowest`).
- **Ne jamais utiliser la classe `bg-scrim`** : le token `scrim` n'est pas défini dans `frontend/tailwind.config.js` et ne produit aucune couleur. Pour les fonds de modal, utiliser `bg-on-surface/40` comme le fait `ForcePasswordModal`.
- **Polices** : `font-headline` (Manrope) pour les titres, corps par défaut (Inter), icônes via `<span className="material-symbols-outlined">`.
- **Couleurs clés** : `on-surface` texte, `on-surface-variant` texte secondaire, `primary` actions, `on-primary` texte sur primary.
- **Empilement** : `TourOverlay` en `z-[60]`, `DocPanel` / `TourInviteModal` en `z-50`. La sidebar existante est en `z-40`, la barre supérieure en `z-30`.
- **Commandes** : `npm` et `uv` ne sont pas dans le PATH. Préfixer par `PATH="/opt/homebrew/bin:$PATH"`.
- **Tests backend** : `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest`.
- **Aucun harnais de test frontend n'existe** et ce plan n'en introduit pas. Les tâches frontend se vérifient par `tsc` et par contrôle manuel.
- **Messages de commit en français**, préfixe conventionnel (`feat:`, `test:`, `docs:`).

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `backend/app/models/user.py` | *(modifié)* colonne `tutorial_seen_at` |
| `backend/app/database.py` | *(modifié)* entrée de migration |
| `backend/app/routes/auth.py` | *(modifié)* `_user_dict` expose `tutorial_seen` |
| `backend/app/routes/me.py` | *(modifié)* `PATCH /preferences` accepte `tutorial_seen` |
| `backend/tests/test_tutorial_seen.py` | *(créé)* les 3 tests backend |
| `frontend/src/api/client.ts` | *(modifié)* `AuthUser.tutorial_seen`, signature de `updatePreferences` |
| `frontend/src/help/content.tsx` | *(créé)* chapitres + illustrations JSX — données, aucune logique |
| `frontend/src/help/tour.ts` | *(créé)* définition des étapes du tour |
| `frontend/src/help/HelpContext.tsx` | *(créé)* état partagé + orchestration de la séquence |
| `frontend/src/help/DocPanel.tsx` | *(créé)* panneau latéral de documentation |
| `frontend/src/help/HelpMenu.tsx` | *(créé)* bouton « ? » et menu déroulant |
| `frontend/src/help/TourOverlay.tsx` | *(créé)* masque, surlignage, bulle |
| `frontend/src/help/TourInviteModal.tsx` | *(créé)* modal de première connexion |
| `frontend/src/help/StartTourButton.tsx` | *(créé)* bouton visible tant que le tour n'est pas suivi |
| `frontend/src/App.tsx` | *(modifié)* montage, attributs `data-tour` |

**Ordre des tâches** : le backend d'abord (1–2), car le frontend en dépend ; puis les données de contenu (3–4), qui n'ont aucune dépendance ; puis le contexte (5) ; puis les composants visuels (6–9) ; enfin le câblage (10) et la vérification (11).

---

### Task 1 : Colonne `tutorial_seen_at` et exposition dans `AuthUser`

**Files:**
- Modify: `backend/app/models/user.py:44` (après `last_login_at`)
- Modify: `backend/app/database.py:74` (dans la liste `_MIGRATIONS`)
- Modify: `backend/app/routes/auth.py:44-51` (fonction `_user_dict`)
- Test: `backend/tests/test_tutorial_seen.py` (créé)

**Interfaces:**
- Consumes: rien.
- Produits pour les tâches suivantes :
  - `User.tutorial_seen_at: datetime | None` (défaut `None`)
  - la clé `"tutorial_seen": bool` dans toutes les réponses d'authentification

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

La fixture `admin_user` renvoie un **tuple** `(user, password)` — voir
`backend/tests/conftest.py:59`. Le décorateur `@pytest.mark.asyncio` est
explicite dans toute la suite, bien que `asyncio_mode = "auto"` soit actif :
suivre la convention du dépôt.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_tutorial_seen.py -v
```

Attendu : ÉCHEC sur `KeyError: 'tutorial_seen'`.

- [ ] **Step 3: Ajouter la colonne au modèle**

Dans `backend/app/models/user.py`, après le champ `last_login_at` :

```python
    tutorial_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
```

- [ ] **Step 4: Ajouter l'entrée de migration**

Dans `backend/app/database.py`, à la fin de la liste `_MIGRATIONS` :

```python
        ("users", "tutorial_seen_at", "DATETIME"),
```

Aucun backfill : les comptes existants gardent `NULL` et verront donc
l'invite, ce qui est voulu.

- [ ] **Step 5: Exposer le booléen**

Dans `backend/app/routes/auth.py`, fonction `_user_dict`, ajouter avant la
parenthèse fermante :

```python
        "tutorial_seen": user.tutorial_seen_at is not None,
```

`_user_dict` est l'unique sérialiseur utilisé par `login`, `refresh`, `setup`,
`google` et `change_password` : cette seule ligne couvre les cinq.

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_tutorial_seen.py -v
```

Attendu : SUCCÈS.

- [ ] **Step 7: Vérifier l'absence de régression**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest -q
```

Attendu : la suite entière passe.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/user.py backend/app/database.py backend/app/routes/auth.py backend/tests/test_tutorial_seen.py
git commit -m "feat(aide): colonne tutorial_seen_at exposée dans AuthUser"
```

---

### Task 2 : Bascule via `PATCH /api/me/preferences`

**Files:**
- Modify: `backend/app/routes/me.py:122-134` (fonction `update_preferences`)
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
    """Écriture seule vers « vu » : relancer le tour ne réarme pas l'invite."""
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

Attendu : les trois nouveaux échouent (`KeyError: 'tutorial_seen'` puis
`assert None is not None`).

- [ ] **Step 3: Implémenter**

Dans `backend/app/routes/me.py`, fonction `update_preferences`, après le bloc
`email_notifications` et avant le `commit` :

```python
    if data.get("tutorial_seen"):
        user.tutorial_seen_at = datetime.now(timezone.utc)
    await session.commit()
    return {
        "email_notifications": user.email_notifications,
        "tutorial_seen": user.tutorial_seen_at is not None,
    }
```

Le `if data.get(...)` sans `else` est délibéré : l'écriture ne va que vers
« vu ». `datetime` et `timezone` sont déjà importés en tête du fichier
(`backend/app/routes/me.py:4`).

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_tutorial_seen.py -v
```

Attendu : les quatre tests du fichier passent.

- [ ] **Step 5: Vérifier l'absence de régression**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest -q
```

Attendu : suite entière verte. `ProfilePage.tsx` consomme la réponse de ce
endpoint : la clé `email_notifications` doit rester présente, ce que le
troisième test garantit.

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
- Consumes: la clé `tutorial_seen` des réponses d'authentification (Task 1) et du endpoint de préférences (Task 2).
- Produits :
  - `AuthUser.tutorial_seen: boolean`
  - `api.me.updatePreferences(data: { email_notifications?: boolean; tutorial_seen?: boolean }): Promise<{ email_notifications: boolean; tutorial_seen: boolean }>`

- [ ] **Step 1: Étendre `AuthUser`**

Dans `frontend/src/api/client.ts`, interface `AuthUser`, après `has_password` :

```ts
  tutorial_seen: boolean;
```

- [ ] **Step 2: Élargir la signature de `updatePreferences`**

Remplacer le bloc `updatePreferences` par :

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

Les deux champs deviennent optionnels : `ProfilePage.tsx:25` appelle déjà avec
le seul `email_notifications` et continue de compiler.

- [ ] **Step 3: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

Attendu : aucune erreur.

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

- [ ] **Step 1: Créer le squelette et les illustrations**

Créer `frontend/src/help/content.tsx`. Commencer par les types et deux
illustrations réutilisables :

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

Ajouter à la suite, dans le même fichier. Le corps de chaque chapitre est du
JSX ; utiliser `<p className="text-sm text-on-surface-variant mb-3">` pour les
paragraphes et `<h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">`
pour les sous-titres.

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
          Le menu de gauche donne accès aux quatre grandes sections. La barre du
          haut affiche le titre de la page courante, vos notifications et ce
          menu d'aide.
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
          Le tableau de bord est la page d'accueil. Il résume l'activité
          récente du club : dernières compétitions importées, patineurs suivis,
          et indicateurs de saison.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Chaque bloc est cliquable et mène à la section correspondante.
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
          Elle réunit l'évolution des scores au fil de la saison, la
          répartition des composantes de programme, et le détail des éléments
          techniques avec leur note d'exécution.
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

- [ ] **Step 3: Rédiger les chapitres du parcours patineur**

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
        le détail de chaque programme. Les graphiques montrent l'évolution au fil
        de la saison.
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
          Une note se compose de deux parties : la <strong>note technique</strong>,
          qui additionne la valeur des éléments réalisés, et les{" "}
          <strong>composantes de programme</strong>, qui évaluent la
          présentation d'ensemble.
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
    audience: ["skater"],
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

- [ ] **Step 4: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

Attendu : aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/help/content.tsx
git commit -m "feat(aide): chapitres de documentation et illustrations"
```

---

### Task 5 : Définition des étapes du tour

**Files:**
- Create: `frontend/src/help/tour.ts`

**Interfaces:**
- Consumes: `Audience` depuis `./content` (Task 4).
- Produits :
  - `type TourStep = { target: string; title: string; body: string; chapterId?: string; audience: Audience[] }`
  - `const TOUR_STEPS: TourStep[]`
  - `function stepsFor(audience: Audience): TourStep[]` — filtre par audience **puis** par présence de la cible dans le DOM.

- [ ] **Step 1: Créer le fichier**

```ts
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

const TOUS: Audience[] = ["club", "skater"];

export const TOUR_STEPS: TourStep[] = [
  {
    target: "sidebar-nav",
    title: "Le menu de navigation",
    body: "Toutes les sections de l'application sont ici. Le menu se replie avec la flèche en bas pour gagner de la place.",
    chapterId: "premiers-pas",
    audience: ["club"],
  },
  {
    target: "sidebar-nav",
    title: "Votre espace",
    body: "Ce menu mène à la page de votre patineur. Si plusieurs patineurs sont rattachés à votre compte, il affiche la liste.",
    chapterId: "bienvenue",
    audience: ["skater"],
  },
  {
    target: "nav-patineurs",
    title: "Les patineurs",
    body: "La liste des patineurs du club. Un clic sur un nom ouvre sa page d'analyse : évolution des scores et détail des éléments.",
    chapterId: "patineurs",
    audience: ["club"],
  },
  {
    target: "nav-competitions",
    title: "Les compétitions",
    body: "Les compétitions importées et leurs résultats. C'est aussi d'ici que de nouveaux résultats sont récupérés.",
    chapterId: "competitions",
    audience: ["club"],
  },
  {
    target: "nav-club",
    title: "Les statistiques du club",
    body: "Une vue d'ensemble sur la saison ou sur une compétition : participations, scores moyens, comparaisons.",
    chapterId: "statistiques-club",
    audience: ["club"],
  },
  {
    target: "topbar-title",
    title: "Où vous êtes",
    body: "Le titre rappelle la page courante. Sur mobile, le bouton à sa gauche ouvre le menu de navigation.",
    audience: TOUS,
  },
  {
    target: "notifications",
    title: "Vos notifications",
    body: "La cloche signale les nouveautés qui vous concernent : résultats d'une compétition, bilan d'entraînement. La pastille indique le nombre de messages non lus.",
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

/** Filtre par parcours, puis élimine les étapes dont la cible n'est pas à
 *  l'écran. Ce second filtre absorbe les différences de rôle — pas de lien
 *  « Compétitions » pour un compte patineur, pas d'« Entraînement » si le
 *  suivi est désactivé — sans dupliquer aucune liste de rôles. */
export function stepsFor(audience: Audience): TourStep[] {
  return TOUR_STEPS.filter(
    (s) =>
      s.audience.includes(audience) &&
      document.querySelector(`[data-tour="${s.target}"]`) !== null
  );
}
```

Noter que `mon-compte` n'existe que pour le parcours patineur dans
`content.tsx` : pour un utilisateur « club », l'étape s'affichera sans le lien
« En savoir plus ». C'est géré en Task 7 (le lien n'est rendu que si le
chapitre existe dans le parcours courant).

- [ ] **Step 2: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

Attendu : aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/help/tour.ts
git commit -m "feat(aide): définition des étapes du tutoriel"
```

---

### Task 6 : Le contexte `HelpProvider`

**Files:**
- Create: `frontend/src/help/HelpContext.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`frontend/src/auth/AuthContext.tsx`), `api.me.updatePreferences` (Task 3), `chaptersFor` / `Chapter` / `Audience` (Task 4), `stepsFor` / `TourStep` (Task 5).
- Produits : `HelpProvider` (props : `{ passwordModalOpen: boolean; children: ReactNode }`) et `useHelp()` renvoyant :

```ts
{
  audience: Audience;
  chapters: Chapter[];          // déjà filtrés par audience
  docChapterId: string | null;  // null = panneau fermé
  openDoc: (chapterId?: string) => void;
  closeDoc: () => void;
  tourSteps: TourStep[];        // figées au démarrage du tour
  tourIndex: number;            // -1 = tour inactif
  tourActive: boolean;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  stopTour: () => void;
  tourSeen: boolean;
  inviteOpen: boolean;
  dismissInvite: () => void;
}
```

- [ ] **Step 1: Créer le fichier**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { chaptersFor, type Audience, type Chapter } from "./content";
import { stepsFor, type TourStep } from "./tour";

interface HelpState {
  audience: Audience;
  chapters: Chapter[];
  docChapterId: string | null;
  openDoc: (chapterId?: string) => void;
  closeDoc: () => void;
  tourSteps: TourStep[];
  tourIndex: number;
  tourActive: boolean;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  stopTour: () => void;
  tourSeen: boolean;
  inviteOpen: boolean;
  dismissInvite: () => void;
}

const HelpContext = createContext<HelpState | null>(null);

const INVITE_DISMISSED_KEY = "tutorial_invite_dismissed";

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
  const [docChapterId, setDocChapterId] = useState<string | null>(null);
  const [tourSteps, setTourSteps] = useState<TourStep[]>([]);
  const [tourIndex, setTourIndex] = useState(-1);
  const [inviteDismissed, setInviteDismissed] = useState(
    () => sessionStorage.getItem(INVITE_DISMISSED_KEY) === "true"
  );

  const audience: Audience = user?.role === "skater" ? "skater" : "club";
  const chapters = useMemo(() => chaptersFor(audience), [audience]);
  const tourSeen = user?.tutorial_seen === true;

  const openDoc = useCallback(
    (chapterId?: string) => {
      setDocChapterId(chapterId ?? chapters[0]?.id ?? null);
    },
    [chapters]
  );

  const closeDoc = useCallback(() => setDocChapterId(null), []);

  /** Persiste « vu » et rafraîchit l'utilisateur en mémoire, pour que le
   *  bouton de démarrage disparaisse sans rechargement. L'échec réseau est
   *  silencieux : le tour a bien été suivi, seul l'état distant manque. */
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
    const steps = stepsFor(audience);
    if (steps.length === 0) return;
    setTourSteps(steps);
    setTourIndex(0);
    setDocChapterId(null);
  }, [audience]);

  const stopTour = useCallback(() => {
    setTourIndex(-1);
    setTourSteps([]);
    void markSeen();
  }, [markSeen]);

  const nextStep = useCallback(() => {
    setTourIndex((i) => {
      if (i + 1 >= tourSteps.length) return i; // dernière étape : stopTour s'en charge
      return i + 1;
    });
  }, [tourSteps.length]);

  const prevStep = useCallback(() => {
    setTourIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const dismissInvite = useCallback(() => {
    sessionStorage.setItem(INVITE_DISMISSED_KEY, "true");
    setInviteDismissed(true);
  }, []);

  const tourActive = tourIndex >= 0 && tourSteps.length > 0;
  const inviteOpen =
    !passwordModalOpen && !tourSeen && !inviteDismissed && !tourActive;

  const value: HelpState = {
    audience,
    chapters,
    docChapterId,
    openDoc,
    closeDoc,
    tourSteps,
    tourIndex,
    tourActive,
    startTour,
    nextStep,
    prevStep,
    stopTour,
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

- [ ] **Step 2: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

Attendu : aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/help/HelpContext.tsx
git commit -m "feat(aide): contexte partagé de l'aide et du tutoriel"
```

---

### Task 7 : Panneau de documentation et menu « ? »

**Files:**
- Create: `frontend/src/help/DocPanel.tsx`
- Create: `frontend/src/help/HelpMenu.tsx`

**Interfaces:**
- Consumes: `useHelp()` (Task 6).
- Produits : `DocPanel` et `HelpMenu`, deux composants sans props.

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

Le pattern de fermeture au clic extérieur reprend celui de
`frontend/src/components/NotificationBell.tsx:39-47`.

```tsx
import { useEffect, useRef, useState } from "react";
import { useHelp } from "./HelpContext";

export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { chapters, openDoc, startTour } = useHelp();

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
              startTour();
            }}
            className="w-full text-left px-4 py-3 hover:bg-surface-container transition-colors flex items-center gap-3"
          >
            <span className="material-symbols-outlined text-lg text-primary shrink-0">
              play_circle
            </span>
            <span className="text-sm font-bold text-on-surface">
              Démarrer le tutoriel
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

Attendu : aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/help/DocPanel.tsx frontend/src/help/HelpMenu.tsx
git commit -m "feat(aide): menu ? et panneau de documentation"
```

---

### Task 8 : La superposition du tutoriel

**Files:**
- Create: `frontend/src/help/TourOverlay.tsx`

**Interfaces:**
- Consumes: `useHelp()` (Task 6).
- Produits : `TourOverlay`, composant sans props.

- [ ] **Step 1: Créer le fichier**

Le masque est fait de quatre rectangles autour de la cible plutôt que d'un
`box-shadow` géant : c'est plus fiable à positionner et la cible reste
cliquable.

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHelp } from "./HelpContext";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;      // marge du surlignage autour de la cible
const BUBBLE_W = 320;
const GAP = 12;     // écart entre la cible et la bulle

export default function TourOverlay() {
  const {
    tourActive,
    tourSteps,
    tourIndex,
    nextStep,
    prevStep,
    stopTour,
    openDoc,
    chapters,
  } = useHelp();
  const [rect, setRect] = useState<Rect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const step = tourActive ? tourSteps[tourIndex] : null;

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
    if (!tourActive) return;
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [tourActive, measure]);

  // Le focus part sur la bulle à chaque étape : le lecteur d'écran annonce le
  // nouveau contenu, et Tab reste dans la bulle.
  useEffect(() => {
    if (tourActive) bubbleRef.current?.focus();
  }, [tourActive, tourIndex]);

  useEffect(() => {
    if (!tourActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopTour();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [tourActive, stopTour]);

  if (!tourActive || !step) return null;

  const isLast = tourIndex === tourSteps.length - 1;
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

  const spaceBelow = window.innerHeight - (box.top + box.height);
  const below = spaceBelow > 220;
  const bubbleTop = below ? box.top + box.height + GAP : undefined;
  const bubbleBottom = below
    ? undefined
    : window.innerHeight - box.top + GAP;
  const bubbleLeft = Math.min(
    Math.max(GAP, box.left + box.width / 2 - BUBBLE_W / 2),
    window.innerWidth - BUBBLE_W - GAP
  );

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Masque en quatre rectangles autour de la cible. */}
      <div aria-hidden="true" onClick={stopTour}>
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

      {/* Anneau de surlignage. */}
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
        aria-label="Tutoriel"
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
              stopTour();
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
            {tourIndex + 1} / {tourSteps.length}
          </span>
          <div className="flex-1" />
          {tourIndex > 0 && (
            <button
              onClick={prevStep}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              Précédent
            </button>
          )}
          <button
            onClick={isLast ? stopTour : nextStep}
            className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold"
          >
            {isLast ? "Terminer" : "Suivant"}
          </button>
        </div>

        <button
          onClick={stopTour}
          className="text-[11px] text-on-surface-variant hover:text-on-surface transition-colors mt-3"
        >
          Passer le tutoriel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

Attendu : aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/help/TourOverlay.tsx
git commit -m "feat(aide): superposition du tutoriel interactif"
```

---

### Task 9 : Modal d'invite et bouton de démarrage

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
          Un tutoriel de quelques étapes vous présente les repères de
          l'interface. Vous pourrez le relancer à tout moment depuis le menu
          d'aide, en haut à droite.
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

`dismissInvite()` est appelé aussi sur « Démarrer » : cela pose le drapeau de
session et évite que l'invite ne reparaisse si l'utilisateur quitte le tour
sans le terminer dans un cas limite.

- [ ] **Step 2: Créer `StartTourButton.tsx`**

```tsx
import { useHelp } from "./HelpContext";

/** Visible tant que le tutoriel n'a pas été suivi. Une fois vu, le tutoriel
 *  reste accessible depuis le menu « ? ». */
export default function StartTourButton() {
  const { tourSeen, tourActive, startTour } = useHelp();

  if (tourSeen || tourActive) return null;

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

Attendu : aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/help/TourInviteModal.tsx frontend/src/help/StartTourButton.tsx
git commit -m "feat(aide): modal d'invite et bouton de démarrage du tutoriel"
```

---

### Task 10 : Câblage dans `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx` — imports, montage du provider, barre supérieure, couches flottantes, 8 attributs `data-tour`

**Interfaces:**
- Consumes: tous les composants des tâches 6 à 9.
- Produits : la fonctionnalité complète en place.

- [ ] **Step 1: Ajouter les imports**

Après la ligne `import NotificationBell from "./components/NotificationBell";` :

```tsx
import { HelpProvider } from "./help/HelpContext";
import HelpMenu from "./help/HelpMenu";
import DocPanel from "./help/DocPanel";
import TourOverlay from "./help/TourOverlay";
import TourInviteModal from "./help/TourInviteModal";
import StartTourButton from "./help/StartTourButton";
```

- [ ] **Step 2: Monter le provider**

Dans `AuthenticatedLayout`, le `return` commence par `<JobProvider>` suivi de
`<div className="flex min-h-screen">`. Insérer `HelpProvider` entre les deux, et
fermer avant `</JobProvider>` :

```tsx
    <JobProvider>
    <HelpProvider passwordModalOpen={showPasswordModal}>
    <div className="flex min-h-screen">
```

et, à la fin du composant, remplacer :

```tsx
      {showPasswordModal && (
        <ForcePasswordModal onClose={dismissPasswordModal} />
      )}
    </JobProvider>
```

par :

```tsx
      {showPasswordModal && (
        <ForcePasswordModal onClose={dismissPasswordModal} />
      )}
      <DocPanel />
      <TourOverlay />
      <TourInviteModal />
    </HelpProvider>
    </JobProvider>
```

`showPasswordModal` est déjà calculé plus haut dans le composant : c'est cette
même valeur qui pilote les deux modals, ce qui garantit qu'ils ne coexistent
jamais et que l'invite apparaît dès la fermeture du premier.

- [ ] **Step 3: Compléter la barre supérieure**

Remplacer le bloc `<header>` par :

```tsx
        <header className="sticky top-0 bg-surface/70 backdrop-blur-xl z-30 shadow-sm flex items-center gap-3 px-4 lg:px-8 py-4">
          <button
            className="lg:hidden text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <span className="material-symbols-outlined text-2xl">menu</span>
          </button>
          <h1
            data-tour="topbar-title"
            className="font-headline font-bold text-on-surface text-xl truncate flex-1"
          >
            {pageTitle}
          </h1>
          <StartTourButton />
          <HelpMenu />
          <div data-tour="notifications">
            <NotificationBell />
          </div>
        </header>
```

`NotificationBell` gère son propre positionnement relatif ; l'envelopper d'un
`div` porteur de l'attribut évite de modifier ce composant.

- [ ] **Step 4: Poser les attributs sur la navigation**

Trois `<nav className="flex-1 py-2">` existent (`SkaterNav`, la nav `coach`, la
nav par défaut). Ajouter `data-tour="sidebar-nav"` **aux trois** :

```tsx
<nav data-tour="sidebar-nav" className="flex-1 py-2">
```

Puis, dans les deux navs qui rendent une liste par `.map(({ to, label, icon, end }) => ...)`
(la nav `coach` et la nav par défaut), ajouter l'attribut sur le `NavLink` en
dérivant la valeur du chemin :

```tsx
              <NavLink
                key={to}
                to={to}
                end={end}
                data-tour={
                  to === "/patineurs"
                    ? "nav-patineurs"
                    : to === "/competitions"
                    ? "nav-competitions"
                    : to === "/club"
                    ? "nav-club"
                    : undefined
                }
                onClick={closeSidebar}
```

Le reste des props du `NavLink` (`title`, `className`) est inchangé. Un
`data-tour` à `undefined` n'émet aucun attribut : les autres liens ne sont pas
ciblés, et les étapes correspondantes seront simplement sautées si le lien
n'existe pas pour ce rôle.

- [ ] **Step 5: Poser l'attribut sur le bloc compte**

Le bas de la sidebar a deux rendus selon `collapsed`. Ajouter
`data-tour="user-account"` sur le conteneur de chacun :

```tsx
            <div data-tour="user-account" className="flex flex-col items-center gap-1 py-2">
```

et

```tsx
            <div data-tour="user-account" className="flex items-center gap-2 px-4 py-2">
```

Un seul des deux est monté à la fois, donc `querySelector` ne trouvera jamais
d'ambiguïté.

- [ ] **Step 6: Vérifier la compilation et le build**

```bash
cd frontend && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit && PATH="/opt/homebrew/bin:$PATH" npm run build
```

Attendu : aucune erreur, build réussi.

- [ ] **Step 7: Vérifier que les 8 ancres sont posées**

```bash
grep -c 'data-tour=' frontend/src/App.tsx
grep -o 'data-tour="[a-z-]*"' frontend/src/App.tsx | sort -u
```

Attendu : `sidebar-nav` (×3), `topbar-title`, `notifications`, `user-account`
(×2) dans `App.tsx` ; `nav-patineurs`, `nav-competitions` et `nav-club` sont
produits dynamiquement par l'expression du Step 4 et n'apparaissent pas sous
cette forme littérale — vérifier leur présence à l'exécution en Task 11.
`help-menu` est porté par `HelpMenu.tsx`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(aide): câblage du menu d'aide et du tutoriel dans le shell"
```

---

### Task 11 : Vérification manuelle et journal de vérification

**Files:**
- Create: `docs/superpowers/plans/2026-09-13-documentation-integree-verification.md`

**Interfaces:**
- Consumes: l'application complète (Tasks 1–10).
- Produits : le constat de vérification, à joindre au rapport final.

- [ ] **Step 1: Lancer la pile**

```bash
make dev-backend    # dans un terminal
make dev-frontend   # dans un autre
```

Backend sur `:8000`, frontend sur `:5173`.

- [ ] **Step 2: Vérifier le parcours « club » (compte admin)**

Se connecter avec un compte admin dont `tutorial_seen_at` est `NULL`. Au
besoin, remettre l'état à zéro :

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

Si la pile tourne hors Docker, viser directement le fichier SQLite du backend.
Penser à vider `sessionStorage` (onglet privé, ou
`sessionStorage.clear()` en console) puisque l'invite y pose son drapeau.

Contrôler, dans l'ordre :

1. Le modal d'invite s'affiche après connexion.
2. « Plus tard » le ferme ; le bouton « Tutoriel » est visible dans la barre.
3. Le bouton lance le tour ; le premier surlignage encadre le menu de gauche.
4. « Suivant » parcourt toutes les étapes ; le compteur est cohérent.
5. « En savoir plus » ferme le tour et ouvre le bon chapitre.
6. `Échap`, la croix, le clic sur le masque et « Terminer » ferment le tour.
7. Après « Terminer », le bouton « Tutoriel » disparaît.
8. Après rechargement de la page, il ne revient pas, et l'invite non plus.
9. Le menu « ? » ouvre chaque chapitre ; la navigation précédent/suivant
   parcourt le parcours « club » en entier.

- [ ] **Step 3: Vérifier le parcours « patineur »**

Se connecter avec un compte de rôle `skater` (le remettre lui aussi à `NULL`).
Contrôler :

1. Le menu « ? » ne liste que les chapitres du parcours patineur — aucune
   mention de l'import de compétitions ni de l'administration.
2. Le tour saute les étapes « Patineurs », « Compétitions » et « Club », dont
   les liens n'existent pas pour ce rôle : le compteur total est plus petit que
   pour l'admin, et aucune étape ne surligne le vide.

- [ ] **Step 4: Vérifier l'enchaînement avec le modal de mot de passe**

Depuis l'administration, forcer le changement de mot de passe sur un compte de
test, puis s'y connecter (`sessionStorage` vidé). Contrôler :

1. Le modal de mot de passe s'affiche **seul** — l'invite du tutoriel n'est pas
   derrière.
2. Le fermer par la croix, sans changer le mot de passe : l'invite du tutoriel
   apparaît immédiatement.
3. Recommencer en changeant réellement le mot de passe : l'invite apparaît de
   même après la fermeture.

- [ ] **Step 5: Vérifier le responsive**

Réduire la fenêtre sous 640 px. Contrôler que le bouton « Tutoriel » n'affiche
que son icône, que le panneau de documentation occupe toute la largeur, et que
la bulle du tour reste entièrement dans l'écran à chaque étape.

- [ ] **Step 6: Consigner le constat**

Écrire `docs/superpowers/plans/2026-09-13-documentation-integree-verification.md`
avec, pour chacun des points des étapes 2 à 5, le résultat observé. Noter
explicitement tout écart plutôt que de le corriger en silence.

- [ ] **Step 7: Lancer la suite backend une dernière fois**

```bash
cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest -q
```

Attendu : suite entière verte.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-documentation-integree-verification.md
git commit -m "docs(aide): constat de vérification manuelle"
```

---

## Auto-revue

**Couverture du spec.** Chaque section du spec a sa tâche : illustrations JSX
(Task 4) ; deux parcours et filtrage par `audience` (Tasks 4, 5, 6) ;
persistance en base et exposition (Tasks 1, 2, 3) ; tour sur une page avec
renvois (Tasks 5, 8) ; ancrage `data-tour` et saut des cibles absentes
(Tasks 5, 10) ; séquence d'accueil (Tasks 6, 9, 10) ; comptes existants sans
backfill (Task 1, Step 4) ; accessibilité (Tasks 7, 8, 9) ; les trois tests
backend (Tasks 1, 2) ; vérification manuelle (Task 11).

**Écart assumé par rapport au spec.** Le spec annonçait trois tests backend ;
le plan en pose quatre — le quatrième vérifie que `tutorial_seen` n'écrase pas
`email_notifications`, une régression réelle sur un endpoint partagé avec
`ProfilePage`.

**Cohérence des types.** `Audience` est défini une fois dans `content.tsx` et
importé par `tour.ts` et `HelpContext.tsx`. `Chapter.id` alimente
`TourStep.chapterId`, `openDoc()` et `chapters.findIndex()`. La clé
`tutorial_seen` porte le même nom du modèle SQLAlchemy à `AuthUser`.
`stepsFor()` / `chaptersFor()` sont nommés et appelés de façon identique
partout.

**Conventions de test vérifiées dans le dépôt.** La fixture `admin_user`
renvoie `(user, password)` et non un `User` (`conftest.py:59`) ; le mot de
passe est `testpass123` ; `POST /api/auth/login` répond `200`
(`test_auth.py:11`) ; `@pytest.mark.asyncio` est posé explicitement sur chaque
test malgré `asyncio_mode = "auto"` ; un test de `PATCH /api/me/preferences`
existe déjà (`test_notifications.py:177`) et sert de modèle. Les quatre tests
du plan suivent ces conventions.
