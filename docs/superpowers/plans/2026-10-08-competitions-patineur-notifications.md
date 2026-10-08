# Compétitions visibles par les comptes patineur + notifications — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un compte `skater` voit les classements complets des compétitions où ses patineurs ont un résultat (sans accès aux profils/détails des autres) et reçoit une notification groupée quand les scores, feuilles de score ou classements de ses patineurs sont publiés.

**Architecture:** Un helper `visible_competition_ids` ouvre les routes compétition/scores au rôle `skater` en minimisant les lignes des autres patineurs (`is_own`). `run_import`/`run_enrich` renvoient une liste `changes` ; une nouvelle couche `job_handlers.handle_job` (type de job `poll` = import + enrich) appelle `notify_competition_changes`, qui crée une notification par (utilisateur, compétition) + email.

**Tech Stack:** Python 3 / Litestar / SQLAlchemy async / SQLite / pytest-asyncio ; React + TypeScript + Vite + Tailwind + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-08-competitions-patineur-notifications-design.md`

## Global Constraints

- Tout texte d'interface et de notification en **français**.
- `uv` et `npm` ne sont pas dans le PATH : préfixer `PATH="/opt/homebrew/bin:$PATH"`.
- Tests backend : `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest …` (SQLite en mémoire, `asyncio_mode = "auto"`).
- Pas de nouvelle dépendance.
- Ne jamais notifier pour une compétition dont `polling_enabled` est faux.
- Un changement de rang seul (segment `rank` ou `overall_rank`) ne produit **aucune** notification.
- Design system Kinetic Lens : Tailwind seul, pas de bordures de section, scores en `font-mono`.
- Messages de commit terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `backend/app/auth/guards.py` (mod.) | + `visible_competition_ids` |
| `backend/app/routes/competitions.py` (mod.) | liste/détail ouverts au rôle `skater`, filtrés |
| `backend/app/routes/scores.py` (mod.) | classements complets + minimisation + `is_own` |
| `backend/app/services/import_service.py` (mod.) | `changes` dans `run_import`/`run_enrich`, correction des valeurs, retrait de la notif admin |
| `backend/app/services/notification_service.py` (mod.) | + `format_skater_changes`, `notify_competition_changes` |
| `backend/app/templates/emails/skater_competition_notification.html` (créé) | email patineur |
| `backend/app/services/job_handlers.py` (créé) | `handle_job` : import/reimport/enrich/poll + notifications |
| `backend/app/main.py` (mod.) | délègue à `handle_job`, le polling soumet `poll` |
| `frontend/src/api/client.ts`, `contexts/JobContext.tsx`, `components/AdminJobsTab.tsx`, `components/NotificationBell.tsx`, `pages/CompetitionPage.tsx`, `App.tsx` (mod.) | UI |
| Tests : `tests/test_skater_competitions.py`, `tests/test_import_changes.py`, `tests/test_competition_notifications.py`, `tests/test_job_handlers.py` (créés) ; `tests/test_scores_scoping.py`, `tests/test_skater_access.py` (mod.) | |

---

### Task 1 : Accès compétition pour le rôle `skater`

**Files:**
- Modify: `backend/app/auth/guards.py` (fin de fichier)
- Modify: `backend/app/routes/competitions.py:1-84`
- Modify: `backend/tests/test_skater_access.py:97-105`
- Create: `backend/tests/test_skater_competitions.py`

**Interfaces:**
- Produces: `async def visible_competition_ids(request: Request, session: AsyncSession) -> set[int] | None` dans `app.auth.guards` — `None` pour les rôles non restreints.

- [ ] **Step 1 : Écrire les tests en échec**

`backend/tests/test_skater_competitions.py` :

```python
import pytest_asyncio

from app.models.category_result import CategoryResult
from app.models.competition import Competition
from app.models.score import Score
from app.models.skater import Skater


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def comps(db_session, skater_user_with_skater):
    """`mine` : le patineur lié a un score ; `cat_only` : seulement un classement ;
    `other` : uniquement un patineur non lié."""
    _, _, linked = skater_user_with_skater
    stranger = Skater(first_name="Bob", last_name="Martin", club="TestClub")
    mine = Competition(name="Mine", url="http://example.com/mine")
    cat_only = Competition(name="CatOnly", url="http://example.com/cat")
    other = Competition(name="Other", url="http://example.com/other")
    db_session.add_all([stranger, mine, cat_only, other])
    await db_session.flush()
    db_session.add_all([
        Score(competition_id=mine.id, skater_id=linked.id, segment="FS"),
        CategoryResult(competition_id=cat_only.id, skater_id=linked.id, category="R1"),
        Score(competition_id=other.id, skater_id=stranger.id, segment="FS"),
    ])
    await db_session.commit()
    return mine, cat_only, other


async def test_skater_lists_only_competitions_with_own_results(client, skater_token, comps):
    mine, cat_only, other = comps
    r = await client.get("/api/competitions/", headers=_auth(skater_token))
    assert r.status_code == 200
    assert {c["id"] for c in r.json()} == {mine.id, cat_only.id}


async def test_skater_gets_own_competition_detail(client, skater_token, comps):
    mine, *_ = comps
    r = await client.get(f"/api/competitions/{mine.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    assert r.json()["name"] == "Mine"


async def test_skater_forbidden_on_other_competition(client, skater_token, comps):
    *_, other = comps
    r = await client.get(f"/api/competitions/{other.id}", headers=_auth(skater_token))
    assert r.status_code == 403


async def test_skater_forbidden_on_unknown_competition(client, skater_token, comps):
    r = await client.get("/api/competitions/999999", headers=_auth(skater_token))
    assert r.status_code == 403


async def test_reader_still_lists_all_competitions(client, reader_token, comps):
    r = await client.get("/api/competitions/", headers=_auth(reader_token))
    assert {c["name"] for c in r.json()} >= {"Mine", "CatOnly", "Other"}
```

Dans `backend/tests/test_skater_access.py`, remplacer `test_skater_cannot_access_competitions` par :

```python
@pytest.mark.asyncio
async def test_skater_without_results_lists_no_competition(client: AsyncClient, skater_setup):
    """Skater sees only competitions where a linked skater has results — none here."""
    token = skater_setup["token"]
    resp = await client.get(
        "/api/competitions/",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_skater_competitions.py tests/test_skater_access.py -v`
Expected: FAIL (403 au lieu de 200 sur la liste et le détail).

- [ ] **Step 3 : Implémenter le helper**

Ajouter à la fin de `backend/app/auth/guards.py` :

```python
async def visible_competition_ids(request: Request, session: AsyncSession) -> set[int] | None:
    """Competitions visible to the current user, or None when the role is not restricted.

    A ``skater`` sees the competitions where at least one linked skater has a
    score or a category result.
    """
    allowed = await linked_skater_ids(request, session)
    if allowed is None:
        return None
    if not allowed:
        return set()

    from sqlalchemy import select, union
    from app.models.category_result import CategoryResult
    from app.models.score import Score

    stmt = union(
        select(Score.competition_id).where(Score.skater_id.in_(allowed)),
        select(CategoryResult.competition_id).where(CategoryResult.skater_id.in_(allowed)),
    )
    result = await session.execute(stmt)
    return set(result.scalars().all())
```

- [ ] **Step 4 : Ouvrir les routes**

Dans `backend/app/routes/competitions.py` :
- imports : `from litestar.exceptions import NotFoundException, PermissionDeniedException` et `from app.auth.guards import reject_skater_role, require_admin, visible_competition_ids` (garder `reject_skater_role` s'il reste utilisé ailleurs dans le fichier — `grep -n reject_skater_role` pour vérifier).
- `list_competitions` : supprimer `reject_skater_role(request)` ; juste avant `result = await session.execute(stmt)` ajouter :

```python
    visible = await visible_competition_ids(request, session)
    if visible is not None:
        stmt = stmt.where(Competition.id.in_(visible))
```

- `get_competition` : remplacer `reject_skater_role(request)` par (contrôle **avant** le 404, pour ne pas révéler quels ids existent) :

```python
    visible = await visible_competition_ids(request, session)
    if visible is not None and competition_id not in visible:
        raise PermissionDeniedException("You do not have access to this competition")
```

- [ ] **Step 5 : Vérifier le succès**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_skater_competitions.py tests/test_skater_access.py tests/test_competition_write_guards.py -v`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/app/auth/guards.py backend/app/routes/competitions.py backend/tests/test_skater_competitions.py backend/tests/test_skater_access.py
git commit -m "feat(skater): accès aux compétitions où ses patineurs ont un résultat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2 : Classements complets avec minimisation

**Files:**
- Modify: `backend/app/routes/scores.py:12-147`
- Modify: `backend/tests/test_scores_scoping.py`

**Interfaces:**
- Consumes: `visible_competition_ids` (Task 1), `linked_skater_ids` (existant).
- Produces: champ `is_own: bool` sur chaque ligne de `GET /api/scores/` et `GET /api/scores/category-results`.

- [ ] **Step 1 : Adapter les tests (comportement nouveau)**

Dans `backend/tests/test_scores_scoping.py` :
- dans le fixture `two_skaters_scored`, donner au score de l'autre patineur des composantes enrichies et un PDF :

```python
    other_score = Score(
        competition_id=comp.id, skater_id=other.id, segment="FS",
        elements=[{"name": "3S"}],
        components={"CO": {"score": 3.4, "factor": 1.0, "judges": [3.25, 3.5]}},
        pdf_path=str(PDF_DIR / "scoping" / "other.pdf"),
    )
```

- ajouter l'import `from app.config import PDF_DIR` (le chemin doit être sous `PDF_DIR`, sinon `pdf_url` serait `None` de toute façon et le test ne prouverait rien) ;
- remplacer `test_skater_lists_only_linked_scores` et `test_skater_lists_only_linked_category_results` par :

```python
async def test_skater_sees_full_ranking_of_own_competition(client, skater_token, two_skaters_scored):
    comp, linked, other, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/?competition_id={comp.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    rows = {s["skater_id"]: s for s in r.json()}
    assert set(rows) == {linked.id, other.id}
    assert rows[linked.id]["is_own"] is True
    assert rows[linked.id]["elements"] == [{"name": "2A"}]
    assert rows[other.id]["is_own"] is False
    assert rows[other.id]["elements"] is None
    assert rows[other.id]["pdf_url"] is None
    assert rows[other.id]["components"] == {"CO": 3.4}


async def test_skater_sees_full_category_results_of_own_competition(client, skater_token, two_skaters_scored):
    comp, linked, other, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/category-results?competition_id={comp.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    flags = {c["skater_id"]: c["is_own"] for c in r.json()}
    assert flags == {linked.id: True, other.id: False}


async def test_skater_without_competition_filter_sees_only_linked(client, skater_token, two_skaters_scored):
    _, linked, *_ = two_skaters_scored
    r = await client.get("/api/scores/", headers=_auth(skater_token))
    assert {s["skater_id"] for s in r.json()} == {linked.id}
    r = await client.get("/api/scores/category-results", headers=_auth(skater_token))
    assert {c["skater_id"] for c in r.json()} == {linked.id}


async def test_skater_gets_nothing_from_foreign_competition(client, db_session, skater_token, two_skaters_scored):
    _, _, other, *_ = two_skaters_scored
    foreign = Competition(name="Foreign", url="http://example.com/foreign")
    db_session.add(foreign)
    await db_session.flush()
    db_session.add(Score(competition_id=foreign.id, skater_id=other.id, segment="FS"))
    await db_session.commit()
    r = await client.get(f"/api/scores/?competition_id={foreign.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    assert r.json() == []
```

- ajouter à `test_reader_still_sees_all_scores` : `assert all(s["is_own"] for s in r.json())`.

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_scores_scoping.py -v`
Expected: FAIL (une seule ligne renvoyée, pas de clé `is_own`).

- [ ] **Step 3 : Implémenter**

Dans `backend/app/routes/scores.py` :
- import : `from app.auth.guards import linked_skater_ids, require_skater_access, visible_competition_ids`
- ajouter un helper partagé :

```python
async def _skater_scope(
    request: Request, session: AsyncSession, competition_id: int | None
) -> tuple[set[int] | None, bool]:
    """Return (linked skater ids or None, whether rows must be filtered to them).

    A skater sees every row of a competition where one of their skaters has a
    result, and only their own rows otherwise.
    """
    allowed = await linked_skater_ids(request, session)
    if allowed is None:
        return None, False
    if competition_id is not None:
        visible = await visible_competition_ids(request, session)
        if competition_id in visible:
            return allowed, False
    return allowed, True
```

- dans `list_scores`, remplacer le bloc `allowed = …` / `if allowed is not None:` et le `return` par :

```python
    allowed, restrict = await _skater_scope(request, session, competition_id)
    if restrict:
        stmt = stmt.where(Score.skater_id.in_(allowed))

    result = await session.execute(stmt)
    scores = result.scalars().all()
    return [_score_to_dict(s, own=allowed is None or s.skater_id in allowed) for s in scores]
```

- même chose dans `list_category_results` avec `CategoryResult.skater_id` et `_category_result_to_dict(cr, own=…)`.
- `_score_to_dict(s: Score, own: bool = True)` : ajouter `"is_own": own`, et pour une ligne étrangère :

```python
        "components": s.components if own else _component_totals(s.components),
        "elements": s.elements if own else None,
        ...
        "pdf_url": _pdf_serving_url(s.pdf_path) if own else None,
        "is_own": own,
```

avec

```python
def _component_totals(components: dict | None) -> dict | None:
    """Keep only the total per component (drop per-judge detail)."""
    if not components:
        return components
    return {k: (v["score"] if isinstance(v, dict) else v) for k, v in components.items()}
```

- `_category_result_to_dict(cr: CategoryResult, own: bool = True)` : ajouter `"is_own": own`.

- [ ] **Step 4 : Vérifier le succès**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_scores_scoping.py tests/test_skater_access.py tests/test_mcp_tools.py -v`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/app/routes/scores.py backend/tests/test_scores_scoping.py
git commit -m "feat(skater): classements complets d'une compétition, détail réservé à ses patineurs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 : Détection des changements dans `run_import`

**Files:**
- Modify: `backend/app/services/import_service.py:118-320`
- Create: `backend/tests/test_import_changes.py`

**Interfaces:**
- Produces: `run_import(...)` renvoie en plus `"changes": list[dict]`, chaque dict = `{"skater_id": int, "kind": "new_score" | "score_corrected" | "final_result", "category": str | None, "segment": str | None, "total_score": float | None, "rank": int | None}` (pour `final_result`, `total_score` = `combined_total` et `rank` = `overall_rank`). `last_import_log` n'inclut **pas** `changes`. `run_import` ne crée plus de notification.
- Produces: `_change(kind, skater_id, category, segment=None, total_score=None, rank=None) -> dict` dans `import_service` (réutilisé en Task 4).

- [ ] **Step 1 : Écrire les tests en échec**

`backend/tests/test_import_changes.py` :

```python
import pytest_asyncio
from sqlalchemy import select

from app.models.category_result import CategoryResult
from app.models.competition import Competition
from app.models.notification import Notification
from app.models.score import Score
from app.services import import_service
from app.services.site_scraper import ScrapedCategoryResult, ScrapedCompetitionInfo, ScrapedResult

CATEGORY = "R1 Novice Femme"


class FakeScraper:
    def __init__(self, results=(), cat_results=(), events=()):
        self.results = list(results)
        self.cat_results = list(cat_results)
        self.events = list(events)

    async def scrape(self, url):
        return self.events, self.results, self.cat_results, ScrapedCompetitionInfo(), ""


def use_scraper(monkeypatch, scraper):
    monkeypatch.setattr(import_service, "get_scraper", lambda url: scraper)


def sp(**overrides):
    base = dict(
        name="Alice DUPONT", club="TCP", category=CATEGORY, segment="SP", rank=3,
        total_score=42.31, technical_score=22.0, component_score=20.31, deductions=0.0,
    )
    base.update(overrides)
    return ScrapedResult(**base)


def cat(**overrides):
    base = dict(name="Alice DUPONT", club="TCP", category=CATEGORY, overall_rank=2,
                combined_total=118.4, segment_count=2)
    base.update(overrides)
    return ScrapedCategoryResult(**base)


@pytest_asyncio.fixture
async def comp(db_session):
    c = Competition(name="Comp", url="http://example.com/changes/index.htm")
    db_session.add(c)
    await db_session.commit()
    return c


async def test_new_score_is_reported(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()]))
    result = await import_service.run_import(db_session, comp.id)
    [change] = result["changes"]
    assert (change["kind"], change["segment"], change["category"], change["total_score"], change["rank"]) == (
        "new_score", "SP", CATEGORY, 42.31, 3)
    score = (await db_session.execute(select(Score))).scalar_one()
    assert change["skater_id"] == score.skater_id
    assert "changes" not in comp.last_import_log


async def test_rank_only_change_is_silent(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()]))
    await import_service.run_import(db_session, comp.id)
    use_scraper(monkeypatch, FakeScraper([sp(rank=5)]))
    result = await import_service.run_import(db_session, comp.id)
    assert result["changes"] == []
    assert (await db_session.execute(select(Score))).scalar_one().rank == 5


async def test_corrected_score_is_reported_and_saved(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()]))
    await import_service.run_import(db_session, comp.id)
    use_scraper(monkeypatch, FakeScraper([sp(total_score=43.31, technical_score=23.0)]))
    result = await import_service.run_import(db_session, comp.id)
    assert [c["kind"] for c in result["changes"]] == ["score_corrected"]
    assert result["changes"][0]["total_score"] == 43.31
    score = (await db_session.execute(select(Score))).scalar_one()
    assert (score.total_score, score.technical_score) == (43.31, 23.0)


async def test_final_result_only_on_combined_total(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()], [cat()]))
    first = await import_service.run_import(db_session, comp.id)
    assert {c["kind"] for c in first["changes"]} == {"new_score", "final_result"}
    final = next(c for c in first["changes"] if c["kind"] == "final_result")
    assert (final["total_score"], final["rank"], final["segment"]) == (118.4, 2, None)

    use_scraper(monkeypatch, FakeScraper([sp()], [cat(overall_rank=3)]))
    second = await import_service.run_import(db_session, comp.id)
    assert second["changes"] == []

    use_scraper(monkeypatch, FakeScraper([sp()], [cat(combined_total=120.0)]))
    third = await import_service.run_import(db_session, comp.id)
    assert [c["kind"] for c in third["changes"]] == ["final_result"]
    assert (await db_session.execute(select(CategoryResult))).scalar_one().combined_total == 120.0


async def test_category_result_without_total_is_silent(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([], [cat(combined_total=None)]))
    result = await import_service.run_import(db_session, comp.id)
    assert result["changes"] == []


async def test_run_import_no_longer_notifies(db_session, comp, admin_user, monkeypatch):
    comp.polling_enabled = True
    await db_session.commit()
    use_scraper(monkeypatch, FakeScraper([sp()]))
    await import_service.run_import(db_session, comp.id)
    assert (await db_session.execute(select(Notification))).scalars().all() == []
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_import_changes.py -v`
Expected: FAIL (`KeyError: 'changes'`, notification admin créée).

- [ ] **Step 3 : Implémenter**

Dans `backend/app/services/import_service.py`, ajouter après `_orphan_skater_query` :

```python
_SCORE_VALUE_FIELDS = ("total_score", "technical_score", "component_score", "deductions")


def _differs(old: float | None, new: float | None) -> bool:
    """True when a scraped value (non-null) differs from the stored one."""
    if new is None:
        return False
    return old is None or round(old, 2) != round(new, 2)


def _score_values_changed(score: Score, r) -> bool:
    return any(_differs(getattr(score, f), getattr(r, f)) for f in _SCORE_VALUE_FIELDS)


def _change(
    kind: str,
    skater_id: int,
    category: str | None,
    segment: str | None = None,
    total_score: float | None = None,
    rank: int | None = None,
) -> dict:
    """A result change worth notifying (see notification_service.notify_competition_changes)."""
    return {
        "skater_id": skater_id,
        "kind": kind,
        "category": category,
        "segment": segment,
        "total_score": total_score,
        "rank": rank,
    }
```

Dans `run_import` :
- à côté de `errors = []` : `changes: list[dict] = []`.
- branche `if existing_score:` — calculer `corrected = _score_values_changed(existing_score, r)` en **premier** ; laisser la branche `if force:` telle quelle ; dans le `else:` (non-force), après la mise à jour du rang, ajouter :

```python
                    if corrected:
                        for field in _SCORE_VALUE_FIELDS:
                            value = getattr(r, field)
                            if value is not None:
                                setattr(existing_score, field, value)
```

  puis, juste avant `skipped += 1` :

```python
                if corrected:
                    changes.append(_change(
                        "score_corrected", skater.id, existing_score.category,
                        existing_score.segment, existing_score.total_score, existing_score.rank,
                    ))
```

- après `session.add(score)` (nouveau score) :

```python
            changes.append(_change("new_score", skater.id, score.category, score.segment, score.total_score, score.rank))
```

- branche `if existing_cr:` — en premier : `total_changed = _differs(existing_cr.combined_total, cr.combined_total)` ; puis, juste avant `cat_skipped += 1` :

```python
                if total_changed:
                    changes.append(_change(
                        "final_result", skater.id, existing_cr.category,
                        total_score=existing_cr.combined_total, rank=existing_cr.overall_rank,
                    ))
```

- après `session.add(cat_result)` :

```python
            if cat_result.combined_total is not None:
                changes.append(_change(
                    "final_result", skater.id, cat_result.category,
                    total_score=cat_result.combined_total, rank=cat_result.overall_rank,
                ))
```

- supprimer le bloc `# Notify admins when a polled competition gets new results` (les 3 lignes `if comp.polling_enabled and …` / import / `await notify_competition_update(...)`) — la couche job s'en charge (Task 6).
- `return {"competition_id": competition_id, **import_log, "changes": changes}`.

- [ ] **Step 4 : Vérifier le succès**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_import_changes.py tests/test_import_club.py tests/test_integration.py -v`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/app/services/import_service.py backend/tests/test_import_changes.py
git commit -m "feat(import): run_import signale les nouveaux scores, corrections et classements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 : Feuille de score disponible dans `run_enrich`

**Files:**
- Modify: `backend/app/services/import_service.py` (`run_enrich`)
- Modify: `backend/tests/test_import_changes.py` (ajout)

**Interfaces:**
- Consumes: `_change` (Task 3).
- Produces: `run_enrich(...)` renvoie `"changes": list[dict]` avec `kind="sheet_available"` (le retour anticipé « aucun PDF » renvoie `"changes": []`).

- [ ] **Step 1 : Écrire le test en échec**

Ajouter à `backend/tests/test_import_changes.py` :

```python
from app.models.skater import Skater
from app.services.name_parser import parse_skater_name
from app.services.site_scraper import ScrapedEvent


async def test_sheet_available_reported_once(db_session, comp, monkeypatch, tmp_path):
    first, last = parse_skater_name("Alice DUPONT")
    skater = Skater(first_name=first, last_name=last, club="TCP")
    db_session.add(skater)
    await db_session.flush()
    db_session.add(Score(competition_id=comp.id, skater_id=skater.id, category=CATEGORY,
                         segment="SP", total_score=42.31, rank=3))
    await db_session.commit()

    pdf = tmp_path / "sp.pdf"
    use_scraper(monkeypatch, FakeScraper(events=[ScrapedEvent(category=CATEGORY, segment="Short Program",
                                                              pdf_url="http://example.com/sp.pdf")]))

    async def fake_download(urls, slug):
        return [pdf]

    monkeypatch.setattr(import_service, "download_pdfs", fake_download)
    monkeypatch.setattr(import_service, "parse_elements", lambda path: [
        {"skater_name": "Alice DUPONT", "elements": [{"name": "2A"}], "category_segment": "x"},
    ])
    monkeypatch.setattr(import_service, "extract_segment_code", lambda value: "SP")

    result = await import_service.run_enrich(db_session, comp.id)
    assert [(c["kind"], c["skater_id"], c["segment"], c["total_score"]) for c in result["changes"]] == [
        ("sheet_available", skater.id, "SP", 42.31)]

    again = await import_service.run_enrich(db_session, comp.id)
    assert again["changes"] == []


async def test_enrich_without_pdf_has_no_changes(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper())
    result = await import_service.run_enrich(db_session, comp.id)
    assert result["changes"] == []
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_import_changes.py -k "sheet or without_pdf" -v`
Expected: FAIL (`KeyError: 'changes'`).

- [ ] **Step 3 : Implémenter**

Dans `run_enrich` :
- retour anticipé : ajouter `"changes": []` au dict.
- à côté de `errors = []` : `changes: list[dict] = []`.
- remplacer le bloc `if not score.elements or force:` par :

```python
                        if not score.elements or force:
                            first_sheet = not score.elements
                            score.elements = elements
                            score.pdf_path = str(pdf_path)
                            enriched += 1
                            if first_sheet and elements:
                                changes.append(_change(
                                    "sheet_available", score.skater_id, score.category,
                                    score.segment, score.total_score, score.rank,
                                ))
```

- ajouter `"changes": changes` au dict retourné en fin de fonction.

- [ ] **Step 4 : Vérifier le succès**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_import_changes.py -v`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/app/services/import_service.py backend/tests/test_import_changes.py
git commit -m "feat(import): run_enrich signale les feuilles de score disponibles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5 : `notify_competition_changes` + email

**Files:**
- Modify: `backend/app/services/notification_service.py`
- Create: `backend/app/templates/emails/skater_competition_notification.html`
- Create: `backend/tests/test_competition_notifications.py`

**Interfaces:**
- Consumes: format des `changes` (Task 3/4).
- Produces: `format_skater_changes(skater_name: str, changes: list[dict]) -> str` et `async def notify_competition_changes(session, competition, changes: list[dict], app_base_url: str = "") -> None` (flush, pas de commit).

- [ ] **Step 1 : Écrire les tests en échec**

`backend/tests/test_competition_notifications.py` :

```python
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.competition import Competition
from app.models.notification import Notification
from app.models.skater import Skater
from app.models.user import User
from app.models.user_skater import UserSkater
from app.services import notification_service
from app.services.notification_service import format_skater_changes, notify_competition_changes


def change(kind, skater_id, segment=None, total=None, rank=None):
    return {"skater_id": skater_id, "kind": kind, "category": "R1", "segment": segment,
            "total_score": total, "rank": rank}


def test_format_score_and_sheet():
    text = format_skater_changes("Ilan Dupont", [
        change("new_score", 1, "SP", 42.31, 3),
        change("sheet_available", 1, "SP", 42.31, 3),
    ])
    assert text == "Ilan Dupont : Programme court 42,31 (3e), feuille de score disponible (Programme court)"


def test_format_correction_and_final_result():
    text = format_skater_changes("Léa Martin", [
        change("score_corrected", 2, "FS", 80.0, 1),
        change("final_result", 2, None, 118.4, 1),
    ])
    assert text == "Léa Martin : Programme libre 80,00 (1er) — score corrigé, Classement général : 1er (118,40)"


def test_format_unknown_segment_keeps_code():
    assert format_skater_changes("A B", [change("new_score", 1, "PB", None, None)]) == "A B : PB"


@pytest_asyncio.fixture
async def world(db_session):
    comp = Competition(name="CR Castres", url="http://example.com/castres", polling_enabled=True)
    alice = Skater(first_name="Alice", last_name="Dupont", club="TCP")
    bob = Skater(first_name="Bob", last_name="Martin", club="TCP")
    carl = Skater(first_name="Carl", last_name="Noël", club="TCP")
    parent1 = User(email="p1@test.com", password_hash="x", display_name="P1", role="skater",
                   email_notifications=True)
    parent2 = User(email="p2@test.com", password_hash="x", display_name="P2", role="skater",
                   email_notifications=False)
    reader = User(email="r@test.com", password_hash="x", display_name="R", role="reader")
    db_session.add_all([comp, alice, bob, carl, parent1, parent2, reader])
    await db_session.flush()
    db_session.add_all([
        UserSkater(user_id=parent1.id, skater_id=alice.id),
        UserSkater(user_id=parent1.id, skater_id=bob.id),
        UserSkater(user_id=parent2.id, skater_id=alice.id),
        UserSkater(user_id=reader.id, skater_id=alice.id),
    ])
    await db_session.commit()
    return comp, alice, bob, carl, parent1, parent2, reader


@pytest.fixture
def sent(monkeypatch):
    emails = []

    async def fake_send_email(**kwargs):
        emails.append(kwargs)
        return True

    async def fake_smtp(session):
        return {"host": "smtp.test"}

    monkeypatch.setattr(notification_service, "send_email", fake_send_email)
    monkeypatch.setattr(notification_service, "get_smtp_config", fake_smtp)
    return emails


async def _notifs(db_session, user):
    stmt = select(Notification).where(Notification.user_id == user.id)
    return (await db_session.execute(stmt)).scalars().all()


async def test_one_grouped_notification_per_user(db_session, world, sent):
    comp, alice, bob, carl, parent1, parent2, reader = world
    await notify_competition_changes(db_session, comp, [
        change("new_score", alice.id, "SP", 42.31, 3),
        change("new_score", bob.id, "SP", 30.0, 7),
        change("sheet_available", alice.id, "SP", 42.31, 3),
        change("new_score", carl.id, "SP", 25.0, 9),
    ], app_base_url="https://skatelab.test")

    [n1] = await _notifs(db_session, parent1)
    assert n1.type == "competition"
    assert n1.title == "Résultats : CR Castres"
    assert n1.link == f"/competitions/{comp.id}"
    assert n1.message.splitlines() == [
        "Alice Dupont : Programme court 42,31 (3e), feuille de score disponible (Programme court)",
        "Bob Martin : Programme court 30,00 (7e)",
    ]
    [n2] = await _notifs(db_session, parent2)
    assert n2.message.splitlines() == [
        "Alice Dupont : Programme court 42,31 (3e), feuille de score disponible (Programme court)",
    ]
    assert await _notifs(db_session, reader) == []

    assert [e["to"] for e in sent] == ["p1@test.com"]
    assert sent[0]["template_name"] == "skater_competition_notification.html"
    assert sent[0]["context"]["app_url"] == f"https://skatelab.test/competitions/{comp.id}"
    assert len(sent[0]["context"]["lines"]) == 2


async def test_nothing_without_changes(db_session, world, sent):
    comp, *_, parent1, parent2, reader = world
    await notify_competition_changes(db_session, comp, [])
    assert await _notifs(db_session, parent1) == []
    assert sent == []


async def test_nothing_when_polling_disabled(db_session, world, sent):
    comp, alice, *_rest = world
    parent1 = _rest[2]
    comp.polling_enabled = False
    await notify_competition_changes(db_session, comp, [change("new_score", alice.id, "SP", 42.31, 3)])
    assert await _notifs(db_session, parent1) == []


async def test_inactive_user_not_notified(db_session, world, sent):
    comp, alice, *_rest = world
    parent1, parent2 = _rest[2], _rest[3]
    parent2.is_active = False
    await db_session.commit()
    await notify_competition_changes(db_session, comp, [change("new_score", alice.id, "SP", 42.31, 3)])
    assert await _notifs(db_session, parent2) == []
    assert len(await _notifs(db_session, parent1)) == 1
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_competition_notifications.py -v`
Expected: FAIL (`ImportError: cannot import name 'format_skater_changes'`).

- [ ] **Step 3 : Implémenter le formatage et la notification**

Ajouter à `backend/app/services/notification_service.py` (après `notify_competition_update`) :

```python
SEGMENT_LABELS = {"SP": "Programme court", "FS": "Programme libre"}


def _fmt_score(value: float) -> str:
    return f"{value:.2f}".replace(".", ",")


def _fmt_rank(rank: int) -> str:
    return "1er" if rank == 1 else f"{rank}e"


def _describe_change(change: dict) -> str:
    segment = SEGMENT_LABELS.get(change["segment"] or "", change["segment"] or "")
    total, rank = change["total_score"], change["rank"]
    if change["kind"] == "sheet_available":
        return f"feuille de score disponible ({segment})"
    if change["kind"] == "final_result":
        text = "Classement général :"
        if rank is not None:
            text += f" {_fmt_rank(rank)}"
        if total is not None:
            text += f" ({_fmt_score(total)})"
        return text
    text = segment
    if total is not None:
        text += f" {_fmt_score(total)}"
    if rank is not None:
        text += f" ({_fmt_rank(rank)})"
    if change["kind"] == "score_corrected":
        text += " — score corrigé"
    return text


def format_skater_changes(skater_name: str, changes: list[dict]) -> str:
    """One notification line for one skater, e.g. "Ilan Dupont : Programme court 42,31 (3e)"."""
    return f"{skater_name} : " + ", ".join(_describe_change(c) for c in changes)


async def notify_competition_changes(
    session: AsyncSession,
    competition,
    changes: list[dict],
    app_base_url: str = "",
) -> None:
    """Notify skater-role users about result changes of their linked skaters.

    One notification (and one email) per user and call, listing each of their
    skaters concerned. Only for competitions being followed (polling enabled).
    """
    if not changes or not competition.polling_enabled:
        return

    changes_by_skater: dict[int, list[dict]] = {}
    for change in changes:
        changes_by_skater.setdefault(change["skater_id"], []).append(change)

    stmt = (
        select(User, UserSkater.skater_id)
        .join(UserSkater, UserSkater.user_id == User.id)
        .where(
            UserSkater.skater_id.in_(changes_by_skater),
            User.role == "skater",
            User.is_active == True,  # noqa: E712
        )
    )
    rows = (await session.execute(stmt)).all()
    if not rows:
        return

    skaters_by_user: dict[str, tuple[User, list[int]]] = {}
    for user, skater_id in rows:
        skaters_by_user.setdefault(user.id, (user, []))[1].append(skater_id)

    names = {sid: await _get_skater_name(session, sid) for sid in changes_by_skater}
    title = f"Résultats : {competition.name}"
    link = f"/competitions/{competition.id}"

    smtp_cfg = await get_smtp_config(session)
    settings = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    club_name = settings.club_name if settings else "SkateLab"

    for user, skater_ids in skaters_by_user.values():
        lines = [
            format_skater_changes(names[sid], changes_by_skater[sid])
            for sid in sorted(skater_ids, key=lambda sid: names[sid])
        ]
        session.add(Notification(
            user_id=user.id,
            type="competition",
            title=title,
            message="\n".join(lines),
            link=link,
        ))

        if user.email_notifications and smtp_cfg:
            await send_email(
                to=user.email,
                subject=title,
                template_name="skater_competition_notification.html",
                context={
                    "club_name": club_name,
                    "competition_name": competition.name,
                    "lines": lines,
                    "app_url": f"{app_base_url}{link}" if app_base_url else "",
                },
                smtp_config=smtp_cfg,
            )

    await session.flush()
```

- [ ] **Step 4 : Créer le template email**

`backend/app/templates/emails/skater_competition_notification.html` :

```html
{% extends "base_email.html" %}
{% block content %}
<h2 style="margin:0 0 16px; font-family:Manrope,sans-serif; font-size:18px; color:#191c1e;">
  Nouveaux résultats
</h2>
<p style="margin:0 0 8px; color:#49454f;">
  Les résultats de <strong>{{ competition_name }}</strong> ont été mis à jour :
</p>
<ul style="margin:0 0 16px; padding-left:20px; font-size:14px; color:#191c1e;">
  {% for line in lines %}
  <li style="margin:0 0 4px;">{{ line }}</li>
  {% endfor %}
</ul>
{% if app_url %}
<p style="margin:16px 0 0;"><a href="{{ app_url }}" class="btn">Voir la compétition</a></p>
{% endif %}
{% endblock %}
```

- [ ] **Step 5 : Vérifier le succès**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_competition_notifications.py tests/test_notifications.py -v`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/app/services/notification_service.py backend/app/templates/emails/skater_competition_notification.html backend/tests/test_competition_notifications.py
git commit -m "feat(notifications): notification groupée des résultats pour les comptes patineur

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6 : Couche job (`poll`) et polling

**Files:**
- Create: `backend/app/services/job_handlers.py`
- Modify: `backend/app/main.py:17, 55-100`
- Create: `backend/tests/test_job_handlers.py`
- Modify: `CLAUDE.md` (ligne « Job queue »)

**Interfaces:**
- Consumes: `run_import`/`run_enrich` avec `changes` (Tasks 3-4), `notify_competition_changes` (Task 5), `notify_competition_update` (existant, inchangé).
- Produces: `async def handle_job(session: AsyncSession, job: dict) -> dict` ; type de job `"poll"` dont le résultat = log d'import à plat + `pdfs_downloaded` + `scores_enriched`. Aucun résultat de job ne contient `changes`.

- [ ] **Step 1 : Écrire les tests en échec**

`backend/tests/test_job_handlers.py` :

```python
import pytest
import pytest_asyncio

from app.models.competition import Competition
from app.services import job_handlers


def imp(changes=(), scores=1):
    return {"competition_id": 1, "status": "success", "events_found": 1, "scores_imported": scores,
            "scores_skipped": 0, "category_results_imported": 0, "category_results_skipped": 0,
            "errors": [], "changes": list(changes)}


def enr(changes=()):
    return {"competition_id": 1, "pdfs_downloaded": 1, "scores_enriched": 1, "unmatched": [],
            "errors": [], "changes": list(changes)}


@pytest_asyncio.fixture
async def comp(db_session):
    c = Competition(name="Comp", url="http://example.com/jobs", polling_enabled=True)
    db_session.add(c)
    await db_session.commit()
    return c


@pytest.fixture
def calls(monkeypatch):
    recorded = {"changes": [], "admin": 0}

    async def fake_changes(session, competition, changes, app_base_url=""):
        recorded["changes"].append(list(changes))

    async def fake_admin(session, competition, import_log, app_base_url=""):
        recorded["admin"] += 1

    monkeypatch.setattr(job_handlers, "notify_competition_changes", fake_changes)
    monkeypatch.setattr(job_handlers, "notify_competition_update", fake_admin)
    return recorded


def fake_runs(monkeypatch, import_result=None, enrich_result=None, enrich_error=None):
    async def fake_import(session, competition_id, force=False):
        return dict(import_result or imp())

    async def fake_enrich(session, competition_id, force=False):
        if enrich_error:
            raise enrich_error
        return dict(enrich_result or enr())

    monkeypatch.setattr(job_handlers, "run_import", fake_import)
    monkeypatch.setattr(job_handlers, "run_enrich", fake_enrich)


async def test_poll_notifies_once_with_merged_changes(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]), enr([{"kind": "sheet_available"}]))
    result = await job_handlers.handle_job(db_session, {"type": "poll", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "new_score"}, {"kind": "sheet_available"}]]
    assert calls["admin"] == 1
    assert result["scores_imported"] == 1
    assert result["scores_enriched"] == 1
    assert result["pdfs_downloaded"] == 1
    assert "changes" not in result


async def test_import_job_notifies_its_changes(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]))
    result = await job_handlers.handle_job(db_session, {"type": "import", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "new_score"}]]
    assert "changes" not in result


async def test_enrich_job_notifies_without_admin(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, enrich_result=enr([{"kind": "sheet_available"}]))
    await job_handlers.handle_job(db_session, {"type": "enrich", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "sheet_available"}]]
    assert calls["admin"] == 0


async def test_no_admin_notification_without_new_rows(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp(scores=0))
    await job_handlers.handle_job(db_session, {"type": "import", "competition_id": comp.id})
    assert calls["admin"] == 0


async def test_no_notification_when_not_polled(db_session, comp, calls, monkeypatch):
    comp.polling_enabled = False
    await db_session.commit()
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]))
    await job_handlers.handle_job(db_session, {"type": "reimport", "competition_id": comp.id})
    assert calls["changes"] == []
    assert calls["admin"] == 0


async def test_poll_still_notifies_import_when_enrich_fails(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]), enrich_error=RuntimeError("pdf down"))
    with pytest.raises(RuntimeError):
        await job_handlers.handle_job(db_session, {"type": "poll", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "new_score"}]]


async def test_unknown_job_type(db_session, comp, calls):
    with pytest.raises(ValueError):
        await job_handlers.handle_job(db_session, {"type": "nope", "competition_id": comp.id})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_job_handlers.py -v`
Expected: FAIL (`ImportError: cannot import name 'job_handlers'`).

- [ ] **Step 3 : Implémenter `job_handlers.py`**

`backend/app/services/job_handlers.py` :

```python
"""Exécution des jobs de la file : import, réimport, enrichissement, suivi (poll).

Les notifications de résultats sont émises ici, une fois le job terminé, et non
dans `run_import`/`run_enrich` : un job `poll` enchaîne import et enrichissement
pour n'envoyer qu'une notification par utilisateur et par passage.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app import config
from app.models.competition import Competition
from app.services.import_service import run_enrich, run_import
from app.services.notification_service import notify_competition_changes, notify_competition_update


async def handle_job(session: AsyncSession, job: dict) -> dict:
    job_type = job["type"]
    competition_id = job["competition_id"]

    if job_type in ("import", "reimport"):
        result = await run_import(session, competition_id, force=job_type == "reimport")
        changes = result.pop("changes", [])
        await _notify(session, competition_id, changes, import_result=result)
        return result

    if job_type == "enrich":
        result = await run_enrich(session, competition_id, force=False)
        changes = result.pop("changes", [])
        await _notify(session, competition_id, changes)
        return result

    if job_type == "poll":
        imported = await run_import(session, competition_id, force=False)
        import_changes = imported.pop("changes", [])
        try:
            enriched = await run_enrich(session, competition_id, force=False)
        except Exception:
            # L'import est déjà commité : ses changements ne réapparaîtront pas
            # au prochain passage, on les notifie avant de propager l'erreur.
            await _notify(session, competition_id, import_changes, import_result=imported)
            raise
        changes = import_changes + enriched.pop("changes", [])
        await _notify(session, competition_id, changes, import_result=imported)
        return {
            **imported,
            "pdfs_downloaded": enriched["pdfs_downloaded"],
            "scores_enriched": enriched["scores_enriched"],
        }

    raise ValueError(f"Unknown job type: {job_type}")


async def _notify(
    session: AsyncSession,
    competition_id: int,
    changes: list[dict],
    import_result: dict | None = None,
) -> None:
    comp = await session.get(Competition, competition_id)
    if not comp or not comp.polling_enabled:
        return
    if import_result and (import_result["scores_imported"] or import_result["category_results_imported"]):
        await notify_competition_update(session, comp, import_result)
    await notify_competition_changes(session, comp, changes, app_base_url=config.PUBLIC_BASE_URL)
    await session.commit()
```

- [ ] **Step 4 : Brancher `main.py`**

Dans `backend/app/main.py` :
- remplacer `from app.services.import_service import run_import, run_enrich` par `from app.services.job_handlers import handle_job` (vérifier avec `grep -n "run_import\|run_enrich" backend/app/main.py` qu'il n'y a pas d'autre usage).
- remplacer le corps de `_handle_job` par :

```python
    async def _handle_job(job: dict) -> dict:
        async with async_session_factory() as session:
            return await handle_job(session, job)
```

- dans `_polling_loop`, remplacer les deux `create_job` et le log par :

```python
                    await job_queue.create_job("poll", comp.id, trigger="auto")
                    logger.info("Polling: submitted poll for competition %d (%s)", comp.id, comp.name)
```

- [ ] **Step 5 : Mettre à jour `CLAUDE.md`**

Remplacer la ligne « **Job queue** » par :

```markdown
- **Job queue**: `services/job_queue.py` — in-process async queue for import/reimport/enrich/poll jobs (`poll` = import + enrich, submitted hourly by the polling loop). Jobs run through `services/job_handlers.py`, which also sends result notifications (admins + `skater` accounts of the skaters concerned, `notify_competition_changes`) for followed competitions (`polling_enabled`)
```

- [ ] **Step 6 : Vérifier le succès**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest tests/test_job_handlers.py tests/test_polling.py tests/test_jobs_api.py tests/test_job_queue_db.py -v`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add backend/app/services/job_handlers.py backend/app/main.py backend/tests/test_job_handlers.py CLAUDE.md
git commit -m "feat(jobs): job poll (import + enrich) et notifications de résultats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 : Frontend

**Files:**
- Modify: `frontend/src/api/client.ts` (types `Score`, `CategoryResult`, `JobInfo`, `FailedJobError`)
- Modify: `frontend/src/contexts/JobContext.tsx:22`
- Modify: `frontend/src/components/AdminJobsTab.tsx:46-90`
- Modify: `frontend/src/components/NotificationBell.tsx:106`
- Modify: `frontend/src/App.tsx:377-383`
- Modify: `frontend/src/pages/CompetitionPage.tsx`

**Interfaces:**
- Consumes: `is_own` (Task 2), type de job `"poll"` (Task 6).

- [ ] **Step 1 : Types**

`client.ts` : ajouter `is_own?: boolean;` à la fin des interfaces `Score` et `CategoryResult` ; remplacer `type: "import" | "reimport" | "enrich";` par `type: "import" | "reimport" | "enrich" | "poll";` dans `JobInfo` et `FailedJobError` ; même remplacement dans `contexts/JobContext.tsx:22`.

- [ ] **Step 2 : Onglet Tâches admin**

`AdminJobsTab.tsx` : ajouter `poll: "Suivi",` à `TYPE_LABELS` et remplacer `const isImport = job.type === "import" || job.type === "reimport";` par `const isImport = job.type === "import" || job.type === "reimport" || job.type === "poll";` (`resultSummary` traite déjà tout non-`enrich` comme un import).

- [ ] **Step 3 : Cloche — messages multi-lignes**

`NotificationBell.tsx:106` : remplacer `className="text-xs text-on-surface-variant truncate mt-0.5"` par

```tsx
className={`text-xs text-on-surface-variant mt-0.5 ${n.type === "competition" ? "whitespace-pre-line line-clamp-3" : "truncate"}`}
```

- [ ] **Step 4 : Route patineur**

`App.tsx`, bloc `user?.role === "skater"` (avant `path="*"`) : ajouter

```tsx
                <Route path="/competitions/:id" element={<CompetitionPage />} />
```

- [ ] **Step 5 : `CompetitionPage.tsx`**

- import : `import { useAuth } from "../auth/AuthContext";`
- ajouter, après `buildCategoryGroups` :

```tsx
/** Lien vers l'analyse du patineur, sauf pour les patineurs d'autrui vus par un compte patineur. */
function SkaterName({
  skaterId,
  firstName,
  lastName,
  isOwn,
}: {
  skaterId: number;
  firstName: string | null;
  lastName: string | null;
  isOwn?: boolean;
}) {
  const label = firstName ? `${firstName} ${lastName}` : (lastName || "-");
  if (isOwn === false) return <span className="font-medium">{label}</span>;
  return (
    <Link to={`/patineurs/${skaterId}/analyse`} className="font-medium hover:text-primary transition-colors">
      {label}
    </Link>
  );
}
```

- dans le tableau des classements de catégorie, remplacer le `<Link …>{cr.skater_first_name ? …}</Link>` par `<SkaterName skaterId={cr.skater_id} firstName={cr.skater_first_name} lastName={cr.skater_last_name} isOwn={cr.is_own} />` ; dans `SegmentScoresTable`, idem avec `s.*` et `isOwn={s.is_own}`.
- dans `CompetitionPage()` : `const { user } = useAuth();` et `const isSkaterRole = user?.role === "skater";` ; remplacer `const isFranceClubs = …` par :

```tsx
  // Le score équipe s'appuie sur des routes interdites au rôle patineur.
  const isFranceClubs = competition.competition_type === "france_clubs" && !isSkaterRole;
```

- lien « Retour » : `to={isSkaterRole ? "/mes-patineurs" : "/competitions"}`.
- Placer `useAuth()` avec les autres hooks, **avant** les `return` anticipés (règle des hooks).

- [ ] **Step 6 : Vérifier**

Run: `cd frontend && PATH="/opt/homebrew/bin:$PATH" npm run build && PATH="/opt/homebrew/bin:$PATH" npm test`
Expected: build sans erreur TypeScript, tests vitest PASS.

- [ ] **Step 7 : Commit**

```bash
git add frontend/src
git commit -m "feat(front): page compétition pour les comptes patineur, job Suivi, notifications multi-lignes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 : Vérification de bout en bout

- [ ] **Step 1 : Suite complète**

Run: `cd backend && PATH="/opt/homebrew/bin:$PATH" uv run pytest -q`
Expected: tout PASS (corriger tout test existant cassé par le nouveau contrat, ex. un test qui supposait `reject_skater_role` sur `/api/competitions/`).

- [ ] **Step 2 : Vérification dans le navigateur**

Lancer la stack (`docker compose up --build` ou `make dev-backend` + `make dev-frontend`), puis via `bb browser-automation` :
1. compte admin : créer un compte `skater` lié à un patineur ayant des scores dans une compétition importée ;
2. compte patineur : depuis la page d'analyse, cliquer sur une compétition → classements complets affichés, seuls ses patineurs sont cliquables, pas d'onglet « Score équipe » ; « Retour » ramène à ses patineurs ;
3. URL directe d'une compétition sans ses patineurs → message d'erreur, aucune donnée ;
4. insérer une notification de test (ou lancer un job `poll` sur une compétition `polling_enabled`) et vérifier l'affichage multi-lignes dans la cloche.

- [ ] **Step 3 : Rapport**

Noter les écarts constatés ; ne pas fusionner sur `main` sans accord de l'utilisateur.
