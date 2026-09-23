# Serveur MCP authentifié — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve an OAuth-protected, read-only MCP endpoint at `{PUBLIC_BASE_URL}/mcp` from the SkateLab backend so any SkateLab user can query competition data from claude.ai or Claude Code, with exactly the rights they have in the web app.

**Architecture:** The official `mcp` SDK (2.x) provides a Starlette app with the Streamable HTTP transport and the OAuth endpoints; we implement its `OAuthAuthorizationServerProvider` on top of three new SQLite tables. An outer ASGI dispatcher (`app.main:app`) sends MCP/OAuth paths to that Starlette app and everything else to the existing Litestar app, so `auth_guard` never sees MCP paths. Tools call allowlisted `GET /api/...` routes in-process ("loopback") with a 60 s JWT minted for the token's user, so role scoping is reused as-is.

**Tech Stack:** Python 3.13, Litestar 2.22, SQLAlchemy async + aiosqlite, `mcp` 2.2 (Starlette), httpx `ASGITransport`, pytest-asyncio; React 19 + TypeScript + Vite + Tailwind, TanStack Query, vitest (node env, `src/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-09-23-serveur-mcp-authentifie-design.md` (read its « Résultats du spike » section first).

## Global Constraints

- `npm` and `uv` are NOT on PATH: use `/opt/homebrew/bin/uv`, `/opt/homebrew/bin/npm` (or `PATH="/opt/homebrew/bin:$PATH"`). If the uv cache is not writable in your sandbox, prefix with `UV_CACHE_DIR=/tmp/claude/uv-cache`.
- Backend tests: `cd backend && /opt/homebrew/bin/uv run pytest -q` (all async, in-memory SQLite). Frontend: `cd frontend && /opt/homebrew/bin/npm test` and `/opt/homebrew/bin/npm run build` (runs `tsc`).
- After changing `backend/pyproject.toml`, run `cd backend && /opt/homebrew/bin/uv lock` — the Dockerfile installs from `uv.lock`.
- **All UI text in French.** Tailwind only, no component library, no borders for sectioning (surface color layering), `font-headline` for titles, `font-mono` for numbers, Material Symbols for icons.
- Any code that opens a DB session outside a Litestar handler MUST call `app.database.async_session_factory` through the module at call time (`import app.database as db_mod` … `db_mod.async_session_factory()`), never `from app.database import async_session_factory` — otherwise tests write to the real DB (see conftest).
- `mcp` version pin: `mcp>=2.2,<3`.
- Scope names: `skatelab:read` (required) and `offline_access`.
- Token lifetimes: access **3600 s**, refresh **30 days** (rotated on every use), pending authorization request **600 s**, authorization code **300 s**, loopback JWT **60 s**.
- Allowed redirect URIs: exactly `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, and `http://localhost:<any port>/callback`, `http://127.0.0.1:<any port>/callback`.
- OAuth endpoints live at the root: `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`. Consent page: `/autorisation?demande=<id>`.
- Competition data only. Never allowlist `/api/training`, `/api/self-eval…`, `/api/admin`, `/api/users`, `/api/jobs`, `/api/reports`, nor any non-GET.
- Commit after each task; end commit messages with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `backend/app/auth/guards.py` (modify) | + `linked_skater_ids()` helper |
| `backend/app/routes/scores.py`, `team_scores.py` (modify) | skater-role scoping fix |
| `backend/app/config.py` (modify) | `PUBLIC_BASE_URL` |
| `backend/app/models/oauth.py` (create) | `OAuthClient`, `OAuthAuthRequest`, `OAuthToken` |
| `backend/app/mcp/__init__.py` (create) | package marker |
| `backend/app/mcp/redirects.py` (create) | redirect allowlist + `SkatelabClient` (port-agnostic loopback) |
| `backend/app/mcp/oauth_provider.py` (create) | `SkatelabOAuthProvider` (SDK provider on the DB) |
| `backend/app/mcp/grants.py` (create) | consent decision, grant listing/revocation, purge (session-injected, used by routes & loop) |
| `backend/app/routes/oauth.py` (create) | `/api/oauth/requests/{id}`, `/api/oauth/consent`, `/api/oauth/grants` |
| `backend/app/mcp/server.py` (create) | `create_mcp_app()` factory, AS metadata override |
| `backend/app/mcp/dispatcher.py` (create) | `McpDispatcher` outer ASGI app + `/register` rate limit |
| `backend/app/mcp/loopback.py` (create) | `current_principal()`, `api_get()` allowlisted in-process calls |
| `backend/app/mcp/tools.py` (create) | tool + resource registration |
| `backend/app/mcp/glossary.md` (create) | scoring vocabulary resource |
| `backend/app/main.py` (modify) | `litestar_app` + `app = McpDispatcher(...)`, MCP lifespan, purge in loop |
| `backend/tests/mcp_helpers.py` (create) | shared test helpers |
| `frontend/src/auth/safeNext.ts` (+ test) | post-login redirect sanitizer |
| `frontend/src/api/client.ts` (modify) | `api.oauth.*` + types |
| `frontend/src/pages/AuthorizePage.tsx` (create) | consent page |
| `frontend/src/components/ConnectedAppsCard.tsx` (create) | « Applications connectées » |
| `frontend/src/pages/LoginPage.tsx`, `ProfilePage.tsx`, `App.tsx` (modify) | wiring |
| `frontend/vite.config.ts`, `nginx.conf` (modify) | proxy MCP/OAuth paths |
| `docs/connecter-claude.md` (create), `CLAUDE.md`, `docs/deployment-guide.md` (modify) | docs |

---

### Task 0: Require admin on competition write routes

Found during the study (route audit, 2026-09-23): in `backend/app/routes/competitions.py`, five write handlers take no `request` and call no guard, so ANY authenticated account (skater, reader, coach) can create, delete, import or enrich competitions. The UI only shows these actions to admins (`CompetitionsPage.tsx` `isAdmin`), and CLAUDE.md defines `reader` as "browse, no manage". The rest of the audit is clean: `auth`/`club_config` public routes are intentional, `self_eval` delegates to `_check_skater_own_access`, `reports` `program/pdf|email` only render submitted data, and the score/team-score read routes are handled by Task 1.

**Files:**
- Modify: `backend/app/routes/competitions.py`
- Test: `backend/tests/test_competition_write_guards.py`
- Modify (only if they break): existing tests calling these endpoints without an admin token

**Interfaces:**
- Produces: `POST /api/competitions/`, `DELETE /api/competitions/{id}`, `POST /api/competitions/{id}/import`, `POST /api/competitions/{id}/enrich`, `POST /api/competitions/bulk-import` return **403** for non-admin roles; admin behaviour unchanged.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_competition_write_guards.py
import pytest
import pytest_asyncio

from app.models.competition import Competition


@pytest_asyncio.fixture
async def comp(db_session):
    c = Competition(name="Comp", url="http://example.com/guards")
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)
    return c


def _calls(comp_id):
    return [
        ("post", "/api/competitions/", {"url": "http://example.com/new"}),
        ("delete", f"/api/competitions/{comp_id}", None),
        ("post", f"/api/competitions/{comp_id}/import", None),
        ("post", f"/api/competitions/{comp_id}/enrich", None),
        ("post", "/api/competitions/bulk-import", {"urls": ["http://example.com/bulk"]}),
    ]


@pytest.mark.parametrize("token_fixture", ["reader_token", "coach_token", "skater_token"])
async def test_non_admin_cannot_write_competitions(client, comp, token_fixture, request):
    token = request.getfixturevalue(token_fixture)
    for method, path, body in _calls(comp.id):
        kwargs = {"headers": {"Authorization": f"Bearer {token}"}}
        if body is not None:
            kwargs["json"] = body
        r = await getattr(client, method)(path, **kwargs)
        assert r.status_code == 403, f"{token_fixture} {method.upper()} {path} -> {r.status_code}"


async def test_admin_can_create_and_delete(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.post("/api/competitions/", json={"url": "http://example.com/admin"}, headers=headers)
    assert r.status_code == 201
    r = await client.delete(f"/api/competitions/{r.json()['id']}", headers=headers)
    assert r.status_code == 204
```

Before writing the body of the `bulk-import` call, read `bulk_import` in `competitions.py` and use the payload key it actually expects (the test only needs the guard to fire before any payload validation — with the guard as the first line, any body gets 403).

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_competition_write_guards.py -v`
Expected: the three parametrized cases FAIL (201/204/200 instead of 403); the admin test PASSES.

- [ ] **Step 3: Implement**

In `backend/app/routes/competitions.py`, for each of `create_competition`, `delete_competition`, `import_competition`, `enrich_competition`, `bulk_import`: add a `request: Request` parameter and make `require_admin(request)` the **first** statement of the body (before any lookup or payload parsing, so non-admins never learn whether an id exists). `require_admin` and `Request` are already imported in this module.

- [ ] **Step 4: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_competition_write_guards.py -v && /opt/homebrew/bin/uv run pytest -q`
Expected: all PASS. If an existing test now fails with 403 because it called one of these endpoints with a non-admin or missing-role token, switch that test to the `admin_token` fixture — do not loosen the guard.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routes/competitions.py backend/tests/test_competition_write_guards.py backend/tests
git commit -m "fix(competitions): réserve la création, suppression et l'import de compétitions aux admins"
```

---

### Task 1: Scope unscoped score routes for the `skater` role

Today `GET /api/scores/`, `GET /api/scores/{id}/elements`, `GET /api/scores/category-results`, `GET /api/competitions/{id}/team-scores` and `GET /api/competitions/{id}/team-medians` have no role check. Fix before exposing them.

**Files:**
- Modify: `backend/app/auth/guards.py`
- Modify: `backend/app/routes/scores.py`
- Modify: `backend/app/routes/team_scores.py`
- Test: `backend/tests/test_scores_scoping.py`

**Interfaces:**
- Produces: `async def linked_skater_ids(request: Request, session: AsyncSession) -> set[int] | None` in `app.auth.guards` — `None` means "no restriction" (non-skater roles).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_scores_scoping.py
import pytest_asyncio

from app.models.category_result import CategoryResult
from app.models.competition import Competition
from app.models.score import Score
from app.models.skater import Skater


@pytest_asyncio.fixture
async def two_skaters_scored(db_session, skater_user_with_skater):
    _, _, linked = skater_user_with_skater
    other = Skater(first_name="Bob", last_name="Martin", club="TestClub")
    comp = Competition(name="Comp", url="http://example.com/scoping")
    db_session.add_all([other, comp])
    await db_session.flush()
    linked_score = Score(competition_id=comp.id, skater_id=linked.id, segment="FS", elements=[{"name": "2A"}])
    other_score = Score(competition_id=comp.id, skater_id=other.id, segment="FS", elements=[{"name": "3S"}])
    db_session.add_all([
        linked_score, other_score,
        CategoryResult(competition_id=comp.id, skater_id=linked.id, category="R1"),
        CategoryResult(competition_id=comp.id, skater_id=other.id, category="R1"),
    ])
    await db_session.commit()
    return comp, linked, other, linked_score, other_score


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_skater_lists_only_linked_scores(client, skater_token, two_skaters_scored):
    comp, linked, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/?competition_id={comp.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    assert {s["skater_id"] for s in r.json()} == {linked.id}


async def test_skater_lists_only_linked_category_results(client, skater_token, two_skaters_scored):
    comp, linked, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/category-results?competition_id={comp.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    assert {c["skater_id"] for c in r.json()} == {linked.id}


async def test_skater_elements_of_linked_score_ok(client, skater_token, two_skaters_scored):
    *_, linked_score, _ = two_skaters_scored
    r = await client.get(f"/api/scores/{linked_score.id}/elements", headers=_auth(skater_token))
    assert r.status_code == 200


async def test_skater_elements_of_other_score_forbidden(client, skater_token, two_skaters_scored):
    *_, other_score = two_skaters_scored
    r = await client.get(f"/api/scores/{other_score.id}/elements", headers=_auth(skater_token))
    assert r.status_code == 403


async def test_skater_team_routes_forbidden(client, skater_token, two_skaters_scored):
    comp, *_ = two_skaters_scored
    for path in (f"/api/competitions/{comp.id}/team-scores", f"/api/competitions/{comp.id}/team-medians"):
        r = await client.get(path, headers=_auth(skater_token))
        assert r.status_code == 403, path


async def test_reader_still_sees_all_scores(client, reader_token, two_skaters_scored):
    comp, linked, other, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/?competition_id={comp.id}", headers=_auth(reader_token))
    assert {s["skater_id"] for s in r.json()} == {linked.id, other.id}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_scores_scoping.py -v`
Expected: the four skater tests FAIL (200 with both skaters / 200 instead of 403); `test_reader_still_sees_all_scores` and `test_skater_elements_of_linked_score_ok` PASS.

- [ ] **Step 3: Implement**

Append to `backend/app/auth/guards.py`:

```python
async def linked_skater_ids(request: Request, session: AsyncSession) -> set[int] | None:
    """Skater ids visible to the current user, or None when the role is not restricted.

    Only the ``skater`` role is restricted to the skaters linked via ``UserSkater``.
    """
    state = request.scope.get("state", {})
    if state.get("user_role") != "skater":
        return None

    from app.models.user_skater import UserSkater
    from sqlalchemy import select

    result = await session.execute(
        select(UserSkater.skater_id).where(UserSkater.user_id == state["user_id"])
    )
    return set(result.scalars().all())
```

In `backend/app/routes/scores.py`:
- change imports: `from litestar import Request, Router, get` and add `from app.auth.guards import linked_skater_ids, require_skater_access`;
- `list_scores(request: Request, session: AsyncSession, ...)`: after the optional filters add

```python
    allowed = await linked_skater_ids(request, session)
    if allowed is not None:
        stmt = stmt.where(Score.skater_id.in_(allowed))
```

- `get_score_elements(score_id: int, request: Request, session: AsyncSession)`: after the 404 check add `await require_skater_access(request, score.skater_id, session)`;
- `list_category_results(request: Request, session: AsyncSession, ...)`: after the optional filters add

```python
    allowed = await linked_skater_ids(request, session)
    if allowed is not None:
        stmt = stmt.where(CategoryResult.skater_id.in_(allowed))
```

In `backend/app/routes/team_scores.py`: import `reject_skater_role` next to `require_admin`; add `request: Request` to `get_competition_team_scores` and `get_competition_medians` and call `reject_skater_role(request)` as their first line.

- [ ] **Step 4: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_scores_scoping.py tests/test_team_scoring.py -v && /opt/homebrew/bin/uv run pytest -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/guards.py backend/app/routes/scores.py backend/app/routes/team_scores.py backend/tests/test_scores_scoping.py
git commit -m "fix(scores): restreint les scores et résultats d'équipe au rôle skater rattaché"
```

---

### Task 2: Dependency, config and OAuth models

**Files:**
- Modify: `backend/pyproject.toml`, `backend/uv.lock`, `backend/app/config.py`, `backend/app/models/__init__.py`
- Create: `backend/app/models/oauth.py`, `backend/app/mcp/__init__.py`
- Test: `backend/tests/test_oauth_models.py`

**Interfaces:**
- Produces: `app.config.PUBLIC_BASE_URL: str` (no trailing slash); models `OAuthClient`, `OAuthAuthRequest`, `OAuthToken` with the columns below (all timestamps that drive expiry are **epoch-second ints**).

- [ ] **Step 1: Add the dependency and lock**

In `backend/pyproject.toml` `dependencies`, add `"mcp>=2.2,<3",` after `"aiosmtplib>=2.0",`. Then:

Run: `cd backend && /opt/homebrew/bin/uv lock && /opt/homebrew/bin/uv sync --extra dev`
Expected: lock updated, `mcp` 2.2.x installed.

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_oauth_models.py
import time

from sqlalchemy import select

from app.models.oauth import OAuthAuthRequest, OAuthClient, OAuthToken


async def test_oauth_tables_roundtrip(db_session, admin_user):
    user, _ = admin_user
    db_session.add(OAuthClient(client_id="c1", client_name="Claude", metadata_json={"client_id": "c1"}))
    db_session.add(OAuthAuthRequest(
        id="req1", client_id="c1", redirect_uri="https://claude.ai/api/mcp/auth_callback",
        redirect_uri_provided_explicitly=True, code_challenge="x" * 43, state="s",
        scopes=["skatelab:read"], resource="http://localhost/mcp", expires_at=int(time.time()) + 600,
    ))
    db_session.add(OAuthToken(
        token_hash="h" * 64, kind="access", family_id="f1", client_id="c1", user_id=user.id,
        user_token_version=user.token_version, scopes=["skatelab:read"], resource="http://localhost/mcp",
        expires_at=int(time.time()) + 3600, granted_at=int(time.time()),
    ))
    await db_session.commit()

    tok = (await db_session.execute(select(OAuthToken))).scalar_one()
    assert tok.revoked_at is None and tok.consumed_at is None and tok.last_used_at is None
    req = await db_session.get(OAuthAuthRequest, "req1")
    assert req.user_id is None and req.code_hash is None


def test_public_base_url_has_no_trailing_slash(monkeypatch):
    import importlib
    import app.config as config

    monkeypatch.setenv("PUBLIC_BASE_URL", "https://skatelab.example.org/")
    try:
        assert importlib.reload(config).PUBLIC_BASE_URL == "https://skatelab.example.org"
    finally:
        monkeypatch.delenv("PUBLIC_BASE_URL")
        importlib.reload(config)
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_oauth_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.oauth'`.

- [ ] **Step 4: Implement**

`backend/app/config.py` — add after the `GOOGLE_CLIENT_ID` line:

```python
# URL publique de l'instance (sans slash final). Sert d'issuer OAuth et de base
# à l'URL MCP ({PUBLIC_BASE_URL}/mcp) : elle doit correspondre EXACTEMENT à
# l'URL que les utilisateurs saisissent dans Claude. HTTPS obligatoire hors localhost.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "http://localhost:5173").rstrip("/")
```

`backend/app/mcp/__init__.py`:

```python
"""Serveur MCP authentifié (OAuth) exposant les données de compétition."""
```

`backend/app/models/oauth.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OAuthClient(Base):
    """Client OAuth enregistré dynamiquement (RFC 7591) — en pratique, Claude."""

    __tablename__ = "oauth_clients"

    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # OAuthClientInformationFull.model_dump(mode="json", exclude_none=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class OAuthAuthRequest(Base):
    """Demande d'autorisation en attente de consentement, puis code d'autorisation.

    Une ligne naît dans /authorize ; le consentement y ajoute user_id + code_hash ;
    l'échange du code la supprime (usage unique).
    """

    __tablename__ = "oauth_auth_requests"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), ForeignKey("oauth_clients.client_id"), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(Boolean, nullable=False)
    code_challenge: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[str | None] = mapped_column(Text, nullable=True)
    scopes: Mapped[list] = mapped_column(JSON, nullable=False)
    resource: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    code_hash: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    code_expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)


class OAuthToken(Base):
    """Jeton d'accès ou de rafraîchissement, stocké haché (SHA-256).

    family_id regroupe tous les jetons issus d'un même consentement : c'est
    l'unité affichée dans « Applications connectées » et révoquée d'un bloc.
    """

    __tablename__ = "oauth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "access" | "refresh"
    family_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String(64), ForeignKey("oauth_clients.client_id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    user_token_version: Mapped[int] = mapped_column(Integer, nullable=False)
    scopes: Mapped[list] = mapped_column(JSON, nullable=False)
    resource: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    granted_at: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_used_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    consumed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revoked_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

`backend/app/models/__init__.py`: add `from app.models.oauth import OAuthAuthRequest, OAuthClient, OAuthToken` and the three names to `__all__`. (New tables are created by `init_db`'s `create_all`; no ALTER needed.)

- [ ] **Step 5: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_oauth_models.py -v && /opt/homebrew/bin/uv run pytest -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app/config.py backend/app/models/oauth.py backend/app/models/__init__.py backend/app/mcp/__init__.py backend/tests/test_oauth_models.py
git commit -m "feat(mcp): dépendance mcp, PUBLIC_BASE_URL et tables OAuth"
```

---

### Task 3: Redirect allowlist and port-agnostic loopback client

The SDK compares redirect URIs exactly; Claude Code uses a new loopback port each session.

**Files:**
- Create: `backend/app/mcp/redirects.py`
- Test: `backend/tests/test_mcp_redirects.py`

**Interfaces:**
- Produces: `is_allowed_redirect(uri: str) -> bool`, `is_loopback(uri: str) -> bool`, `class SkatelabClient(OAuthClientInformationFull)` (overrides `validate_redirect_uri`).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_mcp_redirects.py
import pytest
from mcp.shared.auth import InvalidRedirectUriError
from pydantic import AnyUrl

from app.mcp.redirects import SkatelabClient, is_allowed_redirect, is_loopback


@pytest.mark.parametrize("uri", [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "http://localhost:3118/callback",
    "http://127.0.0.1:50000/callback",
    "http://localhost/callback",
])
def test_allowed(uri):
    assert is_allowed_redirect(uri)


@pytest.mark.parametrize("uri", [
    "https://evil.example/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback?x=1",
    "https://claude.ai.evil.example/api/mcp/auth_callback",
    "http://claude.ai/api/mcp/auth_callback",
    "http://localhost:3118/other",
    "https://localhost:3118/callback",
    "http://user@localhost:3118/callback",
    "http://192.168.1.2:3118/callback",
])
def test_rejected(uri):
    assert not is_allowed_redirect(uri)


def test_is_loopback():
    assert is_loopback("http://127.0.0.1:1/callback")
    assert not is_loopback("https://claude.ai/api/mcp/auth_callback")


def _client(*uris):
    return SkatelabClient(client_id="c", redirect_uris=[AnyUrl(u) for u in uris], token_endpoint_auth_method="none")


def test_loopback_port_is_ignored():
    c = _client("http://localhost:3118/callback")
    assert str(c.validate_redirect_uri(AnyUrl("http://localhost:4000/callback"))) == "http://localhost:4000/callback"


def test_loopback_host_must_match():
    c = _client("http://localhost:3118/callback")
    with pytest.raises(InvalidRedirectUriError):
        c.validate_redirect_uri(AnyUrl("http://127.0.0.1:4000/callback"))


def test_https_redirect_stays_exact():
    c = _client("https://claude.ai/api/mcp/auth_callback")
    assert c.validate_redirect_uri(AnyUrl("https://claude.ai/api/mcp/auth_callback"))
    with pytest.raises(InvalidRedirectUriError):
        c.validate_redirect_uri(AnyUrl("https://claude.com/api/mcp/auth_callback"))
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_redirects.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.mcp.redirects'`.

- [ ] **Step 3: Implement**

```python
# backend/app/mcp/redirects.py
"""Qui a le droit de recevoir un code d'autorisation : uniquement les clients Claude.

Limiter les redirect_uris à Claude empêche un site tiers de s'enregistrer
dynamiquement puis d'hameçonner un consentement SkateLab.
"""
from __future__ import annotations

from urllib.parse import urlsplit

from pydantic import AnyUrl

from mcp.shared.auth import OAuthClientInformationFull

ALLOWED_HTTPS_REDIRECTS = frozenset({
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
})
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1"})


def is_loopback(uri: str) -> bool:
    parts = urlsplit(str(uri))
    return (
        parts.scheme == "http"
        and parts.hostname in LOOPBACK_HOSTS
        and parts.username is None
        and parts.path == "/callback"
        and not parts.query
        and not parts.fragment
    )


def is_allowed_redirect(uri: str) -> bool:
    return str(uri) in ALLOWED_HTTPS_REDIRECTS or is_loopback(uri)


def _without_port(uri: str) -> str:
    parts = urlsplit(str(uri))
    return f"{parts.scheme}://{parts.hostname}{parts.path}"


class SkatelabClient(OAuthClientInformationFull):
    """Client dont les redirections loopback ignorent le port (RFC 8252 §7.3)."""

    def validate_redirect_uri(self, redirect_uri: AnyUrl | None) -> AnyUrl:
        if redirect_uri is not None and is_loopback(str(redirect_uri)):
            target = _without_port(str(redirect_uri))
            for registered in self.redirect_uris or []:
                if is_loopback(str(registered)) and _without_port(str(registered)) == target:
                    return redirect_uri
        return super().validate_redirect_uri(redirect_uri)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_redirects.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mcp/redirects.py backend/tests/test_mcp_redirects.py
git commit -m "feat(mcp): liste blanche des redirections OAuth (clients Claude uniquement)"
```

---

### Task 4: OAuth provider — clients, authorization requests, consent decision, code exchange

**Files:**
- Create: `backend/app/mcp/oauth_provider.py`, `backend/app/mcp/grants.py`, `backend/tests/mcp_helpers.py`
- Modify: `backend/tests/conftest.py` (add `oauth_provider` fixture)
- Test: `backend/tests/test_mcp_provider_codes.py`

**Interfaces:**
- Consumes: `SkatelabClient`, `is_allowed_redirect` (Task 3); models (Task 2).
- Produces:
  - `app.mcp.oauth_provider`: constants `SCOPE = "skatelab:read"`, `SCOPES_SUPPORTED = ["skatelab:read", "offline_access"]`, `ACCESS_TTL = 3600`, `REFRESH_TTL = 2592000`, `REQUEST_TTL = 600`, `CODE_TTL = 300`; `hash_secret(value: str) -> str`; `now() -> int`; `class SkatelabOAuthProvider(base_url: str)` with attributes `base_url`, `resource_url`, SDK methods `get_client`, `register_client`, `authorize`, `load_authorization_code`, `exchange_authorization_code`, and `async issue_tokens(session, *, client_id: str, user: User, scopes: list[str], family_id: str, granted_at: int) -> OAuthToken(SDK)`.
  - `app.mcp.grants`: `class ConsentError(Exception)` with `.reason in {"not_found", "must_change_password", "inactive"}`; `async get_pending_request(session, request_id: str) -> OAuthAuthRequest | None` (None if missing, expired or already decided); `async decide(session, request_id: str, user: User, approve: bool) -> str` (returns the redirect URL).
  - `tests/mcp_helpers.py`: `CLAUDE_REDIRECT`, `BASE`, `async register_test_client(provider, redirect=CLAUDE_REDIRECT) -> SkatelabClient`, `async start_authorization(provider, client, *, redirect=CLAUDE_REDIRECT, state="etat") -> str` (request id), `pkce_pair() -> tuple[str, str]`.

- [ ] **Step 1: Test helpers and fixture**

```python
# backend/tests/mcp_helpers.py
import base64
import hashlib
import secrets
import uuid

from pydantic import AnyUrl

from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull

BASE = "http://localhost"
CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


async def register_test_client(provider, redirect: str = CLAUDE_REDIRECT):
    info = OAuthClientInformationFull(
        client_id=str(uuid.uuid4()),
        client_name="Claude",
        redirect_uris=[AnyUrl(redirect)],
        token_endpoint_auth_method="none",
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        scope="skatelab:read offline_access",
    )
    await provider.register_client(info)
    return await provider.get_client(info.client_id)


async def start_authorization(provider, client, *, redirect: str = CLAUDE_REDIRECT, state: str = "etat",
                              challenge: str | None = None) -> str:
    url = await provider.authorize(client, AuthorizationParams(
        state=state,
        scopes=["skatelab:read", "offline_access"],
        code_challenge=challenge or pkce_pair()[1],
        redirect_uri=AnyUrl(redirect),
        redirect_uri_provided_explicitly=True,
        resource=f"{BASE}/mcp",
    ))
    return url.split("demande=", 1)[1]
```

Append to `backend/tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def oauth_provider(client):
    """Provider OAuth branché sur la base de test (via le monkeypatch de `client`)."""
    from app.mcp.oauth_provider import SkatelabOAuthProvider

    return SkatelabOAuthProvider("http://localhost")
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_mcp_provider_codes.py
import pytest
from pydantic import AnyUrl
from sqlalchemy import select

from mcp.server.auth.provider import AuthorizeError, RegistrationError, TokenError
from mcp.shared.auth import OAuthClientInformationFull

from app.mcp import grants
from app.mcp.oauth_provider import hash_secret
from app.models.oauth import OAuthAuthRequest, OAuthToken
from tests.mcp_helpers import BASE, CLAUDE_REDIRECT, register_test_client, start_authorization


async def test_register_and_get_client(oauth_provider):
    client = await register_test_client(oauth_provider)
    assert client.client_name == "Claude"
    assert type(client).__name__ == "SkatelabClient"


async def test_register_rejects_foreign_redirect(oauth_provider):
    info = OAuthClientInformationFull(client_id="x", redirect_uris=[AnyUrl("https://evil.example/cb")],
                                      token_endpoint_auth_method="none")
    with pytest.raises(RegistrationError) as exc:
        await oauth_provider.register_client(info)
    assert exc.value.error == "invalid_redirect_uri"


async def test_authorize_redirects_to_consent_page(oauth_provider, db_session):
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    req = await db_session.get(OAuthAuthRequest, request_id)
    assert req.resource == f"{BASE}/mcp" and req.user_id is None and req.state == "etat"


async def test_authorize_rejects_other_resource(oauth_provider):
    from mcp.server.auth.provider import AuthorizationParams

    client = await register_test_client(oauth_provider)
    with pytest.raises(AuthorizeError) as exc:
        await oauth_provider.authorize(client, AuthorizationParams(
            state=None, scopes=None, code_challenge="c" * 43, redirect_uri=AnyUrl(CLAUDE_REDIRECT),
            redirect_uri_provided_explicitly=True, resource="https://other.example/mcp"))
    assert exc.value.error == "invalid_target"


async def test_deny_redirects_with_access_denied(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    url = await grants.decide(db_session, request_id, user, approve=False)
    assert url.startswith(CLAUDE_REDIRECT) and "error=access_denied" in url and "state=etat" in url
    assert await db_session.get(OAuthAuthRequest, request_id) is None


async def test_approve_then_exchange_code_once(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    url = await grants.decide(db_session, request_id, user, approve=True)
    code = url.split("code=", 1)[1].split("&", 1)[0]

    auth_code = await oauth_provider.load_authorization_code(client, code)
    assert auth_code.subject == user.id and auth_code.resource == f"{BASE}/mcp"

    token = await oauth_provider.exchange_authorization_code(client, auth_code)
    assert token.access_token and token.refresh_token and token.expires_in == 3600
    rows = (await db_session.execute(select(OAuthToken))).scalars().all()
    assert {r.kind for r in rows} == {"access", "refresh"}
    assert all(r.token_hash != token.access_token for r in rows)  # hashed, never stored raw
    assert any(r.token_hash == hash_secret(token.access_token) for r in rows)

    assert await oauth_provider.load_authorization_code(client, code) is None
    with pytest.raises(TokenError):
        await oauth_provider.exchange_authorization_code(client, auth_code)


async def test_code_bound_to_client(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    other = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    url = await grants.decide(db_session, request_id, user, approve=True)
    code = url.split("code=", 1)[1].split("&", 1)[0]
    assert await oauth_provider.load_authorization_code(other, code) is None


async def test_decide_twice_or_expired_is_not_found(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    await grants.decide(db_session, request_id, user, approve=True)
    with pytest.raises(grants.ConsentError) as exc:
        await grants.decide(db_session, request_id, user, approve=True)
    assert exc.value.reason == "not_found"

    request_id = await start_authorization(oauth_provider, client)
    req = await db_session.get(OAuthAuthRequest, request_id)
    req.expires_at = 0
    await db_session.commit()
    assert await grants.get_pending_request(db_session, request_id) is None


async def test_must_change_password_blocks_consent(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    user.must_change_password = True
    await db_session.commit()
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    with pytest.raises(grants.ConsentError) as exc:
        await grants.decide(db_session, request_id, user, approve=True)
    assert exc.value.reason == "must_change_password"
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_provider_codes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.mcp.oauth_provider'`.

- [ ] **Step 4: Implement the provider (codes part)**

```python
# backend/app/mcp/oauth_provider.py
"""Serveur d'autorisation OAuth 2.1 de SkateLab, adossé à la base.

Le SDK `mcp` fournit les endpoints (/authorize, /token, /register, /revoke) et
vérifie PKCE, l'expiration des codes et la cohérence des redirect_uri. Ce
provider ajoute : stockage, liste blanche des clients, usage unique des codes,
rotation des refresh tokens avec détection de réutilisation, et contrôle de
l'utilisateur (actif, token_version) à chaque requête.
"""
from __future__ import annotations

import hashlib
import secrets
import time

from pydantic import AnyUrl
from sqlalchemy import select, update

import app.database as db_mod
from app.mcp.redirects import SkatelabClient, is_allowed_redirect
from app.models.oauth import OAuthAuthRequest, OAuthClient, OAuthToken as OAuthTokenRow
from app.models.user import User
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

SCOPE = "skatelab:read"
SCOPES_SUPPORTED = [SCOPE, "offline_access"]
ACCESS_TTL = 3600
REFRESH_TTL = 30 * 24 * 3600
REQUEST_TTL = 600
CODE_TTL = 300


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def now() -> int:
    return int(time.time())


def usable_user(user: User | None, token_version: int | None = None) -> bool:
    if user is None or not user.is_active:
        return False
    return token_version is None or user.token_version == token_version


class SkatelabOAuthProvider(OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken, AccessToken]):
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.resource_url = f"{self.base_url}/mcp"

    # --- Clients -----------------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with db_mod.async_session_factory() as session:
            row = await session.get(OAuthClient, client_id)
            return SkatelabClient.model_validate(row.metadata_json) if row else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(u) for u in client_info.redirect_uris or []]
        if not uris or not all(is_allowed_redirect(u) for u in uris):
            raise RegistrationError(
                error="invalid_redirect_uri",
                error_description="Seuls les clients Claude peuvent se connecter à SkateLab",
            )
        async with db_mod.async_session_factory() as session:
            session.add(OAuthClient(
                client_id=client_info.client_id,
                client_name=client_info.client_name,
                metadata_json=client_info.model_dump(mode="json", exclude_none=True),
            ))
            await session.commit()

    # --- Autorisation ------------------------------------------------------

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        if params.resource is not None and params.resource.rstrip("/") != self.resource_url:
            raise AuthorizeError(error="invalid_target", error_description="Ressource inconnue")
        request_id = secrets.token_urlsafe(32)
        async with db_mod.async_session_factory() as session:
            session.add(OAuthAuthRequest(
                id=request_id,
                client_id=client.client_id,
                redirect_uri=str(params.redirect_uri),
                redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
                code_challenge=params.code_challenge,
                state=params.state,
                scopes=params.scopes or [SCOPE],
                resource=self.resource_url,
                expires_at=now() + REQUEST_TTL,
            ))
            await session.commit()
        return f"{self.base_url}/autorisation?demande={request_id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        async with db_mod.async_session_factory() as session:
            req = await self._request_by_code(session, authorization_code)
            if req is None or req.client_id != client.client_id:
                return None
            return AuthorizationCode(
                code=authorization_code,
                scopes=req.scopes,
                expires_at=float(req.code_expires_at),
                client_id=req.client_id,
                code_challenge=req.code_challenge,
                redirect_uri=AnyUrl(req.redirect_uri),
                redirect_uri_provided_explicitly=req.redirect_uri_provided_explicitly,
                resource=req.resource,
                subject=req.user_id,
            )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        async with db_mod.async_session_factory() as session:
            req = await self._request_by_code(session, authorization_code.code)
            if req is None or req.client_id != client.client_id:
                raise TokenError(error="invalid_grant", error_description="Code invalide ou déjà utilisé")
            user = await session.get(User, req.user_id)
            scopes = list(req.scopes)
            await session.delete(req)  # usage unique, même en cas d'échec ci-dessous
            if not usable_user(user):
                await session.commit()
                raise TokenError(error="invalid_grant", error_description="Compte désactivé")
            token = await self.issue_tokens(
                session, client_id=client.client_id, user=user, scopes=scopes,
                family_id=secrets.token_urlsafe(16), granted_at=now(),
            )
            await session.commit()
            return token

    # --- Émission ----------------------------------------------------------

    async def issue_tokens(
        self, session, *, client_id: str, user: User, scopes: list[str], family_id: str, granted_at: int
    ) -> OAuthToken:
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        issued = now()
        for value, kind, ttl in ((access, "access", ACCESS_TTL), (refresh, "refresh", REFRESH_TTL)):
            session.add(OAuthTokenRow(
                token_hash=hash_secret(value), kind=kind, family_id=family_id, client_id=client_id,
                user_id=user.id, user_token_version=user.token_version, scopes=scopes,
                resource=self.resource_url, expires_at=issued + ttl, granted_at=granted_at,
            ))
        return OAuthToken(
            access_token=access, token_type="Bearer", expires_in=ACCESS_TTL,
            refresh_token=refresh, scope=" ".join(scopes),
        )

    @staticmethod
    async def _request_by_code(session, code: str) -> OAuthAuthRequest | None:
        result = await session.execute(
            select(OAuthAuthRequest).where(OAuthAuthRequest.code_hash == hash_secret(code))
        )
        return result.scalar_one_or_none()
```

(`update` is imported for Task 5.)

```python
# backend/app/mcp/grants.py
"""Opérations OAuth appelées depuis les routes Litestar (session injectée)."""
from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.oauth_provider import CODE_TTL, hash_secret, now
from app.models.oauth import OAuthAuthRequest
from app.models.user import User
from mcp.server.auth.provider import construct_redirect_uri


class ConsentError(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


async def get_pending_request(session: AsyncSession, request_id: str) -> OAuthAuthRequest | None:
    req = await session.get(OAuthAuthRequest, request_id)
    if req is None or req.code_hash is not None or req.expires_at < now():
        return None
    return req


async def decide(session: AsyncSession, request_id: str, user: User, approve: bool) -> str:
    req = await get_pending_request(session, request_id)
    if req is None:
        raise ConsentError("not_found")
    if not user.is_active:
        raise ConsentError("inactive")
    if not approve:
        url = construct_redirect_uri(req.redirect_uri, error="access_denied", state=req.state)
        await session.delete(req)
        await session.commit()
        return url
    if user.must_change_password:
        raise ConsentError("must_change_password")
    code = secrets.token_urlsafe(32)
    req.user_id = user.id
    req.code_hash = hash_secret(code)
    req.code_expires_at = now() + CODE_TTL
    await session.commit()
    return construct_redirect_uri(req.redirect_uri, code=code, state=req.state)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_provider_codes.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/mcp/oauth_provider.py backend/app/mcp/grants.py backend/tests/mcp_helpers.py backend/tests/conftest.py backend/tests/test_mcp_provider_codes.py
git commit -m "feat(mcp): provider OAuth — clients, demandes d'autorisation, consentement, codes"
```

---

### Task 5: OAuth provider — token validation, refresh rotation, revocation, grants, purge

**Files:**
- Modify: `backend/app/mcp/oauth_provider.py`, `backend/app/mcp/grants.py`
- Modify: `backend/tests/mcp_helpers.py` (add `issue_test_tokens`)
- Test: `backend/tests/test_mcp_provider_tokens.py`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - provider methods `load_access_token(token) -> AccessToken | None` (with `subject=user.id`, `claims={"role": user.role}`), `load_refresh_token`, `exchange_refresh_token`, `revoke_token`; module function `async revoke_family(session, family_id: str) -> None`.
  - `app.mcp.grants`: `async list_grants(session, user_id: str | None) -> list[dict]` (keys `family_id, client_name, user_id, user_display_name, granted_at, last_used_at`), `async revoke_grant(session, family_id: str, user_id: str | None) -> bool`, `async purge_stale(session) -> None`.
  - `tests/mcp_helpers.py`: `async issue_test_tokens(provider, user) -> OAuthToken` (SDK token response).

- [ ] **Step 1: Test helper**

Append to `backend/tests/mcp_helpers.py`:

```python
async def issue_test_tokens(provider, user):
    """Jetons MCP valides pour `user`, sans passer par le navigateur."""
    import app.database as db_mod
    from app.mcp.oauth_provider import SCOPES_SUPPORTED, now

    client = await register_test_client(provider)
    async with db_mod.async_session_factory() as session:
        token = await provider.issue_tokens(
            session, client_id=client.client_id, user=user, scopes=list(SCOPES_SUPPORTED),
            family_id=secrets.token_urlsafe(16), granted_at=now(),
        )
        await session.commit()
    return token
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_mcp_provider_tokens.py
import pytest
from sqlalchemy import select

from mcp.server.auth.provider import TokenError

from app.mcp import grants
from app.mcp.oauth_provider import hash_secret
from app.models.oauth import OAuthClient, OAuthToken
from tests.mcp_helpers import BASE, issue_test_tokens


async def test_access_token_carries_user_and_role(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    access = await oauth_provider.load_access_token(tok.access_token)
    assert access.subject == user.id and access.claims == {"role": "admin"}
    assert access.resource == f"{BASE}/mcp" and "skatelab:read" in access.scopes


async def test_unknown_or_expired_access_token(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    assert await oauth_provider.load_access_token("nope") is None
    tok = await issue_test_tokens(oauth_provider, user)
    row = (await db_session.execute(select(OAuthToken).where(
        OAuthToken.token_hash == hash_secret(tok.access_token)))).scalar_one()
    row.expires_at = 0
    await db_session.commit()
    assert await oauth_provider.load_access_token(tok.access_token) is None


async def test_deactivation_and_token_version_cut_access(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    user.token_version += 1  # « se déconnecter partout » / changement de mot de passe
    await db_session.commit()
    assert await oauth_provider.load_access_token(tok.access_token) is None

    tok = await issue_test_tokens(oauth_provider, user)
    user.is_active = False
    await db_session.commit()
    assert await oauth_provider.load_access_token(tok.access_token) is None


async def test_refresh_rotates(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    client = await oauth_provider.get_client(
        (await oauth_provider.load_access_token(tok.access_token)).client_id)
    refresh = await oauth_provider.load_refresh_token(client, tok.refresh_token)
    new = await oauth_provider.exchange_refresh_token(client, refresh, refresh.scopes)
    assert new.refresh_token != tok.refresh_token
    assert await oauth_provider.load_access_token(new.access_token) is not None
    assert await oauth_provider.load_refresh_token(client, new.refresh_token) is not None


async def test_refresh_reuse_revokes_family(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    client = await oauth_provider.get_client(
        (await oauth_provider.load_access_token(tok.access_token)).client_id)
    refresh = await oauth_provider.load_refresh_token(client, tok.refresh_token)
    new = await oauth_provider.exchange_refresh_token(client, refresh, refresh.scopes)

    assert await oauth_provider.load_refresh_token(client, tok.refresh_token) is None  # rejoué
    assert await oauth_provider.load_access_token(new.access_token) is None           # famille révoquée
    assert await oauth_provider.load_refresh_token(client, new.refresh_token) is None
    with pytest.raises(TokenError) as exc:
        await oauth_provider.exchange_refresh_token(client, refresh, refresh.scopes)
    assert exc.value.error == "invalid_grant"


async def test_revoke_token_revokes_family(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    access = await oauth_provider.load_access_token(tok.access_token)
    await oauth_provider.revoke_token(access)
    assert await oauth_provider.load_access_token(tok.access_token) is None


async def test_list_and_revoke_grants(oauth_provider, db_session, admin_user, reader_user):
    admin, _ = admin_user
    reader, _ = reader_user
    await issue_test_tokens(oauth_provider, admin)
    reader_tok = await issue_test_tokens(oauth_provider, reader)

    mine = await grants.list_grants(db_session, reader.id)
    assert len(mine) == 1 and mine[0]["client_name"] == "Claude" and mine[0]["user_display_name"] == "Test Reader"
    assert len(await grants.list_grants(db_session, None)) == 2

    assert not await grants.revoke_grant(db_session, mine[0]["family_id"], admin.id)  # pas à lui
    assert await grants.revoke_grant(db_session, mine[0]["family_id"], reader.id)
    assert await oauth_provider.load_access_token(reader_tok.access_token) is None
    assert await grants.list_grants(db_session, reader.id) == []


async def test_purge_removes_unused_clients(oauth_provider, db_session, admin_user):
    from datetime import datetime, timedelta, timezone

    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    stale = OAuthClient(client_id="stale", client_name="Claude", metadata_json={"client_id": "stale"},
                        created_at=datetime.now(timezone.utc) - timedelta(days=31))
    db_session.add(stale)
    await db_session.commit()

    await grants.purge_stale(db_session)
    assert await db_session.get(OAuthClient, "stale") is None
    assert await oauth_provider.load_access_token(tok.access_token) is not None
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_provider_tokens.py -v`
Expected: FAIL (`load_access_token` not implemented — the SDK Protocol default returns `None`/raises; `grants.list_grants` missing).

- [ ] **Step 4: Implement**

Append to `SkatelabOAuthProvider` in `backend/app/mcp/oauth_provider.py`:

```python
    # --- Validation & rotation --------------------------------------------

    async def load_access_token(self, token: str) -> AccessToken | None:
        async with db_mod.async_session_factory() as session:
            row = await self._token_row(session, token, "access")
            if row is None or row.revoked_at is not None or row.expires_at < now():
                return None
            user = await session.get(User, row.user_id)
            if not usable_user(user, row.user_token_version):
                return None
            if row.last_used_at is None or row.last_used_at < now() - 300:
                row.last_used_at = now()  # limité à une écriture / 5 min
                await session.commit()
            return AccessToken(
                token=token, client_id=row.client_id, scopes=list(row.scopes),
                expires_at=row.expires_at, resource=row.resource, subject=user.id,
                claims={"role": user.role},
            )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        async with db_mod.async_session_factory() as session:
            row = await self._token_row(session, refresh_token, "refresh")
            if row is None or row.client_id != client.client_id:
                return None
            if row.consumed_at is not None:
                # Un refresh déjà échangé est rejoué : vol probable, on coupe tout.
                await revoke_family(session, row.family_id)
                await session.commit()
                return None
            if row.revoked_at is not None or row.expires_at < now():
                return None
            if not usable_user(await session.get(User, row.user_id), row.user_token_version):
                return None
            return RefreshToken(
                token=refresh_token, client_id=row.client_id, scopes=list(row.scopes),
                expires_at=row.expires_at, resource=row.resource, subject=row.user_id,
            )

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        async with db_mod.async_session_factory() as session:
            row = await self._token_row(session, refresh_token.token, "refresh")
            if row is None or row.consumed_at is not None or row.revoked_at is not None:
                raise TokenError(error="invalid_grant", error_description="Jeton de rafraîchissement invalide")
            user = await session.get(User, row.user_id)
            if not usable_user(user, row.user_token_version):
                raise TokenError(error="invalid_grant", error_description="Compte désactivé")
            row.consumed_at = now()
            token = await self.issue_tokens(
                session, client_id=row.client_id, user=user, scopes=scopes,
                family_id=row.family_id, granted_at=row.granted_at,
            )
            await session.commit()
            return token

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with db_mod.async_session_factory() as session:
            result = await session.execute(
                select(OAuthTokenRow).where(OAuthTokenRow.token_hash == hash_secret(token.token))
            )
            row = result.scalar_one_or_none()
            if row is not None:
                await revoke_family(session, row.family_id)
                await session.commit()

    @staticmethod
    async def _token_row(session, token: str, kind: str) -> OAuthTokenRow | None:
        result = await session.execute(
            select(OAuthTokenRow).where(
                OAuthTokenRow.token_hash == hash_secret(token), OAuthTokenRow.kind == kind
            )
        )
        return result.scalar_one_or_none()
```

And a module-level function (after the class):

```python
async def revoke_family(session, family_id: str) -> None:
    await session.execute(
        update(OAuthTokenRow)
        .where(OAuthTokenRow.family_id == family_id, OAuthTokenRow.revoked_at.is_(None))
        .values(revoked_at=now())
    )
```

Append to `backend/app/mcp/grants.py` (extend the imports: `from datetime import datetime, timedelta, timezone`, `from sqlalchemy import delete, func, select`, `from app.mcp.oauth_provider import CODE_TTL, hash_secret, now, revoke_family`, `from app.models.oauth import OAuthAuthRequest, OAuthClient, OAuthToken`):

```python
STALE_CLIENT_DAYS = 30


async def list_grants(session: AsyncSession, user_id: str | None) -> list[dict]:
    """Autorisations actives (une par famille), de l'utilisateur ou de tous (None)."""
    stmt = (
        select(OAuthToken, OAuthClient.client_name, User.display_name)
        .join(OAuthClient, OAuthClient.client_id == OAuthToken.client_id)
        .join(User, User.id == OAuthToken.user_id)
        .where(
            OAuthToken.kind == "refresh",
            OAuthToken.revoked_at.is_(None),
            OAuthToken.consumed_at.is_(None),
            OAuthToken.expires_at > now(),
        )
        .order_by(OAuthToken.granted_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(OAuthToken.user_id == user_id)
    rows = (await session.execute(stmt)).all()
    if not rows:
        return []
    families = [tok.family_id for tok, _, _ in rows]
    last_used = dict((await session.execute(
        select(OAuthToken.family_id, func.max(OAuthToken.last_used_at))
        .where(OAuthToken.family_id.in_(families))
        .group_by(OAuthToken.family_id)
    )).all())
    return [
        {
            "family_id": tok.family_id,
            "client_name": client_name or "Client inconnu",
            "user_id": tok.user_id,
            "user_display_name": display_name,
            "granted_at": tok.granted_at,
            "last_used_at": last_used.get(tok.family_id),
        }
        for tok, client_name, display_name in rows
    ]


async def revoke_grant(session: AsyncSession, family_id: str, user_id: str | None) -> bool:
    """Révoque une famille ; `user_id` restreint au propriétaire (None = admin)."""
    stmt = select(OAuthToken.id).where(OAuthToken.family_id == family_id).limit(1)
    if user_id is not None:
        stmt = stmt.where(OAuthToken.user_id == user_id)
    if (await session.execute(stmt)).scalar_one_or_none() is None:
        return False
    await revoke_family(session, family_id)
    await session.commit()
    return True


async def purge_stale(session: AsyncSession) -> None:
    """Ménage horaire : demandes expirées, jetons morts depuis 30 j, clients inutilisés."""
    cutoff = now() - STALE_CLIENT_DAYS * 24 * 3600
    await session.execute(delete(OAuthAuthRequest).where(OAuthAuthRequest.expires_at < now() - CODE_TTL))
    await session.execute(delete(OAuthToken).where(OAuthToken.expires_at < cutoff))
    live_clients = select(OAuthToken.client_id).where(OAuthToken.expires_at > now()).distinct()
    pending_clients = select(OAuthAuthRequest.client_id).distinct()
    created_before = datetime.now(timezone.utc) - timedelta(days=STALE_CLIENT_DAYS)
    await session.execute(
        delete(OAuthClient).where(
            OAuthClient.created_at < created_before,
            OAuthClient.client_id.not_in(live_clients),
            OAuthClient.client_id.not_in(pending_clients),
        )
    )
    await session.commit()
```

- [ ] **Step 5: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_provider_tokens.py tests/test_mcp_provider_codes.py -v`
Expected: all PASS. (If the `created_at` comparison fails because SQLite returns naive datetimes, compare with `created_before.replace(tzinfo=None)` — the existing models store naive UTC.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/mcp/oauth_provider.py backend/app/mcp/grants.py backend/tests/mcp_helpers.py backend/tests/test_mcp_provider_tokens.py
git commit -m "feat(mcp): validation des jetons, rotation des refresh, révocation et ménage"
```

---

### Task 6: Consent and grants API routes

**Files:**
- Create: `backend/app/routes/oauth.py`
- Modify: `backend/app/main.py` (register router only)
- Test: `backend/tests/test_oauth_routes.py`

**Interfaces:**
- Consumes: `app.mcp.grants.*` (Tasks 4–5), `is_loopback` (Task 3).
- Produces (all require the normal app JWT):
  - `GET /api/oauth/requests/{request_id:str}` → `200 {"request_id", "client_name", "redirect_host", "is_loopback", "role"}` or `404`.
  - `POST /api/oauth/consent` body `{"request_id": str, "approve": bool}` → `200 {"redirect_url": str}`; `404` not found/expired, `409` must change password, `403` inactive.
  - `GET /api/oauth/grants?all=false` → `list[grant dict]`; `all=true` requires admin.
  - `DELETE /api/oauth/grants/{family_id:str}` → `204`; `404` if not owner (non-admin) or unknown.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_oauth_routes.py
from tests.mcp_helpers import issue_test_tokens, register_test_client, start_authorization


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_request_details_and_approve(client, oauth_provider, skater_token):
    oc = await register_test_client(oauth_provider)
    rid = await start_authorization(oauth_provider, oc)

    r = await client.get(f"/api/oauth/requests/{rid}", headers=_auth(skater_token))
    assert r.status_code == 200
    body = r.json()
    assert body["client_name"] == "Claude" and body["redirect_host"] == "claude.ai"
    assert body["is_loopback"] is False and body["role"] == "skater"

    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": True}, headers=_auth(skater_token))
    assert r.status_code == 200
    assert r.json()["redirect_url"].startswith("https://claude.ai/api/mcp/auth_callback?code=")


async def test_loopback_request_is_flagged(client, oauth_provider, admin_token):
    oc = await register_test_client(oauth_provider, redirect="http://localhost:3118/callback")
    rid = await start_authorization(oauth_provider, oc, redirect="http://localhost:3118/callback")
    r = await client.get(f"/api/oauth/requests/{rid}", headers=_auth(admin_token))
    assert r.json()["is_loopback"] is True and r.json()["redirect_host"] == "localhost"


async def test_unknown_request_404(client, admin_token):
    r = await client.get("/api/oauth/requests/nope", headers=_auth(admin_token))
    assert r.status_code == 404
    r = await client.post("/api/oauth/consent", json={"request_id": "nope", "approve": True}, headers=_auth(admin_token))
    assert r.status_code == 404


async def test_consent_requires_login(client, oauth_provider):
    oc = await register_test_client(oauth_provider)
    rid = await start_authorization(oauth_provider, oc)
    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": True})
    assert r.status_code == 401


async def test_must_change_password_409(client, db_session, oauth_provider, admin_user, admin_token):
    user, _ = admin_user
    user.must_change_password = True
    await db_session.commit()
    oc = await register_test_client(oauth_provider)
    rid = await start_authorization(oauth_provider, oc)
    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": True}, headers=_auth(admin_token))
    assert r.status_code == 409


async def test_grants_listing_and_revocation(client, oauth_provider, reader_user, reader_token, admin_token):
    reader, _ = reader_user
    await issue_test_tokens(oauth_provider, reader)

    r = await client.get("/api/oauth/grants", headers=_auth(reader_token))
    assert r.status_code == 200 and len(r.json()) == 1
    family = r.json()[0]["family_id"]

    assert (await client.get("/api/oauth/grants?all=true", headers=_auth(reader_token))).status_code == 403
    assert len((await client.get("/api/oauth/grants?all=true", headers=_auth(admin_token))).json()) == 1

    assert (await client.delete(f"/api/oauth/grants/{family}", headers=_auth(reader_token))).status_code == 204
    assert (await client.get("/api/oauth/grants", headers=_auth(reader_token))).json() == []


async def test_cannot_revoke_someone_elses_grant(client, oauth_provider, admin_user, reader_token):
    admin, _ = admin_user
    await issue_test_tokens(oauth_provider, admin)
    import app.database as db_mod
    from app.mcp import grants

    async with db_mod.async_session_factory() as s:
        family = (await grants.list_grants(s, admin.id))[0]["family_id"]
    assert (await client.delete(f"/api/oauth/grants/{family}", headers=_auth(reader_token))).status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_oauth_routes.py -v`
Expected: FAIL with 404 on every `/api/oauth/...` call.

- [ ] **Step 3: Implement**

```python
# backend/app/routes/oauth.py
"""Consentement OAuth et « Applications connectées » (UI SkateLab)."""
from __future__ import annotations

from urllib.parse import urlsplit

from litestar import Request, Router, delete, get, post
from litestar.di import Provide
from litestar.exceptions import ClientException, NotFoundException, PermissionDeniedException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import require_admin
from app.database import get_session
from app.mcp import grants
from app.mcp.redirects import is_loopback
from app.models.oauth import OAuthClient
from app.models.user import User


async def _current_user(request: Request, session: AsyncSession) -> User:
    user = await session.get(User, request.scope["state"]["user_id"])
    if user is None:
        raise NotFoundException("Utilisateur introuvable")
    return user


@get("/requests/{request_id:str}")
async def get_request(request_id: str, request: Request, session: AsyncSession) -> dict:
    req = await grants.get_pending_request(session, request_id)
    if req is None:
        raise NotFoundException("Demande introuvable ou expirée")
    oauth_client = await session.get(OAuthClient, req.client_id)
    return {
        "request_id": req.id,
        "client_name": (oauth_client.client_name if oauth_client else None) or "Client inconnu",
        "redirect_host": urlsplit(req.redirect_uri).hostname,
        "is_loopback": is_loopback(req.redirect_uri),
        "role": request.scope["state"]["user_role"],
    }


@post("/consent", status_code=200)
async def consent(data: dict, request: Request, session: AsyncSession) -> dict:
    user = await _current_user(request, session)
    try:
        url = await grants.decide(session, str(data.get("request_id", "")), user, bool(data.get("approve")))
    except grants.ConsentError as e:
        if e.reason == "must_change_password":
            raise ClientException(status_code=409, detail="Changez d'abord votre mot de passe")
        if e.reason == "inactive":
            raise PermissionDeniedException("Compte désactivé")
        raise NotFoundException("Demande introuvable ou expirée")
    return {"redirect_url": url}


@get("/grants")
async def list_grants(request: Request, session: AsyncSession, all: bool = False) -> list[dict]:
    if all:
        require_admin(request)
        return await grants.list_grants(session, None)
    return await grants.list_grants(session, request.scope["state"]["user_id"])


@delete("/grants/{family_id:str}")
async def revoke_grant(family_id: str, request: Request, session: AsyncSession) -> None:
    state = request.scope["state"]
    owner = None if state["user_role"] == "admin" else state["user_id"]
    if not await grants.revoke_grant(session, family_id, owner):
        raise NotFoundException("Autorisation introuvable")


router = Router(
    path="/api/oauth",
    route_handlers=[get_request, consent, list_grants, revoke_grant],
    dependencies={"session": Provide(get_session)},
)
```

In `backend/app/main.py`: `from app.routes.oauth import router as oauth_router` and add `oauth_router` to `route_handlers`.

- [ ] **Step 4: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_oauth_routes.py -v && /opt/homebrew/bin/uv run pytest -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routes/oauth.py backend/app/main.py backend/tests/test_oauth_routes.py
git commit -m "feat(mcp): API de consentement OAuth et des applications connectées"
```

---

### Task 7: MCP app factory, outer dispatcher, wiring and end-to-end OAuth flow

**Files:**
- Create: `backend/app/mcp/server.py`, `backend/app/mcp/dispatcher.py`, `backend/app/mcp/loopback.py`, `backend/app/mcp/tools.py` (with `whoami` only in this task)
- Modify: `backend/app/main.py`, `backend/tests/conftest.py` (add `mcp_http` fixture), `backend/tests/mcp_helpers.py` (add `mcp_call`)
- Test: `backend/tests/test_mcp_http.py`

**Interfaces:**
- Consumes: `SkatelabOAuthProvider`, `SCOPE`, `SCOPES_SUPPORTED` (Task 4).
- Produces:
  - `app.mcp.server.create_mcp_app(base_url: str | None = None) -> tuple[MCPServer, Starlette]` (defaults to `config.PUBLIC_BASE_URL`; each call is a fresh instance whose `server.session_manager.run()` must be entered exactly once).
  - `app.mcp.dispatcher.McpDispatcher(litestar_app, mcp_app)`, `is_mcp_path(path: str) -> bool`, `register_limiter`.
  - `app.mcp.loopback.current_principal() -> tuple[str, str]` (user_id, role); `async api_get(path: str, params: dict | None = None) -> Any`; `ALLOWED_PATHS`.
  - `app.mcp.tools.register_tools(server: MCPServer) -> None`.
  - `app.main.litestar_app` (the Litestar instance), `app.main.app` (the dispatcher, uvicorn entrypoint unchanged), `app.main.mcp_server`.
  - `tests/mcp_helpers.py`: `async mcp_call(http, token: str, method: str, params: dict | None = None) -> dict` (returns the JSON-RPC `result`).

- [ ] **Step 1: Test fixture and helper**

Append to `backend/tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def mcp_http(client):
    """Client HTTP vers le dispatcher complet (Litestar + MCP), base http://localhost."""
    from app.main import litestar_app
    from app.mcp.dispatcher import McpDispatcher
    from app.mcp.server import create_mcp_app

    server, mcp_app = create_mcp_app("http://localhost")
    async with server.session_manager.run():
        transport = ASGITransport(app=McpDispatcher(litestar_app, mcp_app))
        async with AsyncClient(transport=transport, base_url="http://localhost") as c:
            yield c
```

Append to `backend/tests/mcp_helpers.py`:

```python
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json",
               "mcp-protocol-version": "2025-06-18"}


async def mcp_call(http, token: str, method: str, params: dict | None = None) -> dict:
    r = await http.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
                        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "error" not in body, body
    return body["result"]


def tool_json(result: dict):
    """Contenu JSON d'un résultat d'outil (texte du premier bloc)."""
    import json

    assert result["isError"] is False, result
    return json.loads(result["content"][0]["text"])
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_mcp_http.py
from urllib.parse import parse_qs, urlsplit

from tests.mcp_helpers import CLAUDE_REDIRECT, issue_test_tokens, mcp_call, pkce_pair, tool_json


async def test_unauthenticated_mcp_gets_401_with_resource_metadata(mcp_http):
    r = await mcp_http.post("/mcp", json={})
    assert r.status_code == 401
    assert 'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"' in r.headers["www-authenticate"]


async def test_discovery_documents(mcp_http):
    prm = (await mcp_http.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert prm["resource"] == "http://localhost/mcp"
    assert prm["authorization_servers"] == ["http://localhost"]

    asm = (await mcp_http.get("/.well-known/oauth-authorization-server")).json()
    assert asm["issuer"] == "http://localhost"
    assert asm["registration_endpoint"] == "http://localhost/register"
    assert "none" in asm["token_endpoint_auth_methods_supported"]
    assert asm["code_challenge_methods_supported"] == ["S256"]
    assert "offline_access" in asm["scopes_supported"]


async def test_api_routes_still_served_by_litestar(mcp_http):
    assert (await mcp_http.get("/api/health")).json() == {"status": "ok"}


async def test_register_rejects_foreign_redirect(mcp_http):
    r = await mcp_http.post("/register", json={"redirect_uris": ["https://evil.example/cb"],
                                               "token_endpoint_auth_method": "none"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_redirect_uri"


async def test_register_is_rate_limited(mcp_http, monkeypatch):
    from app.auth.rate_limit import LoginRateLimiter
    import app.mcp.dispatcher as dispatcher

    monkeypatch.setattr(dispatcher, "register_limiter", LoginRateLimiter(max_attempts=1, window_seconds=60))
    body = {"redirect_uris": [CLAUDE_REDIRECT], "token_endpoint_auth_method": "none"}
    assert (await mcp_http.post("/register", json=body)).status_code == 201
    assert (await mcp_http.post("/register", json=body)).status_code == 429


async def test_full_oauth_flow_then_whoami(mcp_http, admin_user, admin_token):
    user, _ = admin_user
    reg = (await mcp_http.post("/register", json={
        "redirect_uris": [CLAUDE_REDIRECT], "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        "client_name": "Claude"})).json()
    verifier, challenge = pkce_pair()

    r = await mcp_http.get("/authorize", params={
        "response_type": "code", "client_id": reg["client_id"], "redirect_uri": CLAUDE_REDIRECT,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz",
        "scope": "skatelab:read offline_access", "resource": "http://localhost/mcp"})
    assert r.status_code == 302
    location = r.headers["location"]
    assert location.startswith("http://localhost/autorisation?demande=")
    request_id = parse_qs(urlsplit(location).query)["demande"][0]

    r = await mcp_http.post("/api/oauth/consent", json={"request_id": request_id, "approve": True},
                            headers={"Authorization": f"Bearer {admin_token}"})
    callback = parse_qs(urlsplit(r.json()["redirect_url"]).query)
    assert callback["state"] == ["xyz"]

    r = await mcp_http.post("/token", data={
        "grant_type": "authorization_code", "code": callback["code"][0], "redirect_uri": CLAUDE_REDIRECT,
        "client_id": reg["client_id"], "code_verifier": verifier, "resource": "http://localhost/mcp"})
    assert r.status_code == 200, r.text
    tokens = r.json()

    me = tool_json(await mcp_call(mcp_http, tokens["access_token"], "tools/call", {"name": "whoami", "arguments": {}}))
    assert me["id"] == user.id and me["role"] == "admin" and me["display_name"] == "Test Admin"

    r = await mcp_http.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                            "client_id": reg["client_id"]})
    assert r.status_code == 200 and r.json()["refresh_token"] != tokens["refresh_token"]

    r = await mcp_http.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                            "client_id": reg["client_id"]})
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


async def test_wrong_pkce_verifier_rejected(mcp_http, admin_token):
    reg = (await mcp_http.post("/register", json={"redirect_uris": [CLAUDE_REDIRECT],
                                                  "token_endpoint_auth_method": "none"})).json()
    _, challenge = pkce_pair()
    r = await mcp_http.get("/authorize", params={
        "response_type": "code", "client_id": reg["client_id"], "redirect_uri": CLAUDE_REDIRECT,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": "s"})
    request_id = parse_qs(urlsplit(r.headers["location"]).query)["demande"][0]
    r = await mcp_http.post("/api/oauth/consent", json={"request_id": request_id, "approve": True},
                            headers={"Authorization": f"Bearer {admin_token}"})
    code = parse_qs(urlsplit(r.json()["redirect_url"]).query)["code"][0]
    r = await mcp_http.post("/token", data={"grant_type": "authorization_code", "code": code,
                                            "redirect_uri": CLAUDE_REDIRECT, "client_id": reg["client_id"],
                                            "code_verifier": pkce_pair()[0]})
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


async def test_token_for_other_resource_rejected(mcp_http, db_session, oauth_provider, admin_user):
    from sqlalchemy import update
    from app.models.oauth import OAuthToken

    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    await db_session.execute(update(OAuthToken).values(resource="https://other.example/mcp"))
    await db_session.commit()
    r = await mcp_http.post("/mcp", json={}, headers={"Authorization": f"Bearer {tok.access_token}"})
    assert r.status_code == 401
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_http.py -v`
Expected: FAIL at fixture setup with `ImportError: cannot import name 'litestar_app' from 'app.main'`.

- [ ] **Step 4: Implement loopback, whoami tool, server factory, dispatcher**

```python
# backend/app/mcp/loopback.py
"""Appels in-process aux routes GET existantes, au nom de l'utilisateur du jeton MCP.

Chaque outil passe par ici : les règles d'accès des routes (skater rattaché,
reject_skater_role…) s'appliquent donc telles quelles, sans duplication.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

import httpx

from app.auth.tokens import create_access_token
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver.exceptions import ToolError

logger = logging.getLogger("app.mcp")

LOOPBACK_JWT_TTL = 60

# Liste blanche : données de compétition uniquement, GET uniquement.
ALLOWED_PATHS = tuple(re.compile(p) for p in (
    r"^/api/me/skaters$",
    r"^/api/skaters/$",
    r"^/api/skaters/\d+$",
    r"^/api/skaters/\d+/(scores|elements|category-results|seasons)$",
    r"^/api/competitions/$",
    r"^/api/competitions/seasons$",
    r"^/api/competitions/\d+$",
    r"^/api/competitions/\d+/team-scores$",
    r"^/api/scores/\d+/elements$",
    r"^/api/stats/(progression-ranking|benchmarks|element-mastery|competition-club-analysis)$",
))


def current_principal() -> tuple[str, str]:
    token = get_access_token()
    if token is None or not token.subject:
        raise ToolError("Session MCP non authentifiée")
    return token.subject, (token.claims or {}).get("role", "reader")


async def api_get(path: str, params: dict | None = None) -> Any:
    if not any(p.match(path) for p in ALLOWED_PATHS):
        raise ToolError(f"Route non autorisée : {path}")
    from app.main import litestar_app  # import tardif : app.main importe ce module

    user_id, role = current_principal()
    jwt = create_access_token(user_id=user_id, role=role, expires_seconds=LOOPBACK_JWT_TTL)
    query = {k: v for k, v in (params or {}).items() if v is not None}
    started = time.monotonic()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=litestar_app),
                                 base_url="http://skatelab.internal") as http:
        response = await http.get(path, params=query, headers={"Authorization": f"Bearer {jwt}"})
    logger.info("mcp user=%s role=%s GET %s %s -> %s (%.0f ms)", user_id, role, path, query,
                response.status_code, (time.monotonic() - started) * 1000)
    if response.status_code == 403:
        raise ToolError("Accès refusé : ces données ne sont pas visibles avec votre compte "
                        "(réservé à l'encadrement du club ou à d'autres patineurs).")
    if response.status_code == 404:
        raise ToolError("Introuvable.")
    if response.status_code >= 400:
        raise ToolError(f"Erreur SkateLab ({response.status_code}).")
    return response.json()
```

```python
# backend/app/mcp/tools.py
"""Outils MCP (lecture seule, données de compétition)."""
from __future__ import annotations

import app.database as db_mod
from app.mcp.loopback import current_principal
from app.models.user import User
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)


def register_tools(server: MCPServer) -> None:
    @server.tool(annotations=READ_ONLY)
    async def whoami() -> dict:
        """Identité du compte SkateLab connecté (nom, email, rôle).

        Rôles : admin et reader/coach voient les données du club ; skater ne voit
        que ses patineurs rattachés (voir list_my_skaters).
        """
        user_id, _ = current_principal()
        async with db_mod.async_session_factory() as session:
            user = await session.get(User, user_id)
            if user is None:
                raise ToolError("Utilisateur introuvable")
            return {"id": user.id, "display_name": user.display_name, "email": user.email, "role": user.role}
```

```python
# backend/app/mcp/server.py
"""Fabrique de l'app MCP (transport Streamable HTTP + serveur d'autorisation)."""
from __future__ import annotations

from starlette.applications import Starlette
from starlette.routing import Route

from app import config
from app.mcp.oauth_provider import SCOPE, SCOPES_SUPPORTED, SkatelabOAuthProvider
from app.mcp.tools import register_tools
from mcp.server.auth.handlers.metadata import MetadataHandler
from mcp.server.auth.routes import build_metadata, cors_middleware
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer

INSTRUCTIONS = (
    "Données de compétition de patinage artistique du club (SkateLab) : patineurs, "
    "scores par segment, éléments et GOE, composantes (PCS), résultats par catégorie, "
    "statistiques du club. Lisez la ressource skatelab://glossaire pour le vocabulaire. "
    "Commencez par whoami : un compte « skater » ne voit que ses patineurs rattachés."
)
TOKEN_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"]


def _auth_server_metadata_route(auth: AuthSettings) -> Route:
    """Métadonnées RFC 8414 du SDK, complétées de « none » (clients publics acceptés)."""
    metadata = build_metadata(auth.issuer_url, auth.service_documentation_url,
                              auth.client_registration_options, auth.revocation_options)
    metadata.token_endpoint_auth_methods_supported = TOKEN_AUTH_METHODS
    metadata.revocation_endpoint_auth_methods_supported = TOKEN_AUTH_METHODS
    return Route(
        "/.well-known/oauth-authorization-server",
        endpoint=cors_middleware(MetadataHandler(metadata).handle, ["GET", "OPTIONS"]),
        methods=["GET", "OPTIONS"],
    )


def create_mcp_app(base_url: str | None = None) -> tuple[MCPServer, Starlette]:
    base = (base_url or config.PUBLIC_BASE_URL).rstrip("/")
    auth = AuthSettings(
        issuer_url=base,  # chaîne, pas AnyHttpUrl : sinon un « / » final casse la comparaison d'issuer
        resource_server_url=f"{base}/mcp",
        validate_token_resource=True,
        required_scopes=[SCOPE],
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=SCOPES_SUPPORTED, default_scopes=SCOPES_SUPPORTED),
        revocation_options=RevocationOptions(enabled=True),
    )
    server = MCPServer(
        name="skatelab", title="SkateLab", instructions=INSTRUCTIONS,
        auth_server_provider=SkatelabOAuthProvider(base), auth=auth,
    )
    register_tools(server)
    starlette_app = server.streamable_http_app(
        streamable_http_path="/mcp", stateless_http=True, json_response=True, host="0.0.0.0",
    )
    starlette_app.router.routes.insert(0, _auth_server_metadata_route(auth))
    return server, starlette_app
```

```python
# backend/app/mcp/dispatcher.py
"""Point d'entrée ASGI : chemins MCP/OAuth → app du SDK, le reste → Litestar.

Le lifespan est confié à Litestar, dont un des lifespans démarre le session
manager MCP (voir app.main).
"""
from __future__ import annotations

from starlette.responses import JSONResponse

from app.auth.rate_limit import LoginRateLimiter

MCP_EXACT_PATHS = frozenset({"/mcp", "/authorize", "/token", "/register", "/revoke"})
WELL_KNOWN_PREFIX = "/.well-known/oauth-"

# Claude enregistre un client à chaque nouvelle connexion : plafond global, large
# pour un club, mais qui borne le remplissage de la table par un tiers.
register_limiter = LoginRateLimiter(max_attempts=30, window_seconds=3600.0)


def is_mcp_path(path: str) -> bool:
    return path in MCP_EXACT_PATHS or path.startswith(WELL_KNOWN_PREFIX)


class McpDispatcher:
    def __init__(self, litestar_app, mcp_app):
        self.litestar_app = litestar_app
        self.mcp_app = mcp_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and is_mcp_path(scope["path"]):
            if scope["path"] == "/register" and scope["method"] == "POST":
                if not register_limiter.is_allowed("global"):
                    response = JSONResponse(
                        {"error": "invalid_client_metadata",
                         "error_description": "Trop d'enregistrements, réessayez plus tard"},
                        status_code=429,
                    )
                    await response(scope, receive, send)
                    return
                register_limiter.record("global")
            await self.mcp_app(scope, receive, send)
            return
        await self.litestar_app(scope, receive, send)
```

Note: `register_limiter` is read through the module global at call time, so the test's `monkeypatch.setattr(dispatcher, "register_limiter", ...)` takes effect.

- [ ] **Step 5: Wire `app/main.py`**

1. Add imports: `from app.mcp.dispatcher import McpDispatcher`, `from app.mcp.server import create_mcp_app`, `from app.mcp.grants import purge_stale`.
2. Before `cors_config`, add:

```python
mcp_server, mcp_asgi = create_mcp_app()


@asynccontextmanager
async def mcp_lifespan(_: Litestar) -> AsyncGenerator[None, None]:
    async with mcp_server.session_manager.run():
        yield
```

3. Rename `app = Litestar(` to `litestar_app = Litestar(` and change `lifespan=[lifespan]` to `lifespan=[lifespan, mcp_lifespan]`.
4. At the end of the file:

```python
# Point d'entrée uvicorn (app.main:app) : dispatcher MCP/OAuth devant Litestar.
app = McpDispatcher(litestar_app, mcp_asgi)
```

5. In `_polling_loop`, after the `except Exception: logger.exception("Error in polling loop")` block (still inside `while True`), add:

```python
        try:
            async with async_session_factory() as session:
                await purge_stale(session)
        except Exception:
            logger.exception("Error purging OAuth data")
```

Check nothing else relied on `app` being a Litestar instance:

Run: `cd backend && grep -rn "from app.main import\|app\.main\b" app tests ../Dockerfile.backend ../Makefile`
Expected: only `from app.main import app` (conftest — works, the dispatcher forwards `/api/*`), `_should_disable_polling` imports, and `app.main:app` in Dockerfile/Makefile (still valid ASGI).

- [ ] **Step 6: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_http.py -v && /opt/homebrew/bin/uv run pytest -q`
Expected: all PASS. If `test_token_for_other_resource_rejected` gets 403 instead of 401, check `AuthSettings.validate_token_resource` behaviour in the installed SDK and assert the status it returns — the point is that it is not 200.

- [ ] **Step 7: Manual smoke test with Claude Code (local)**

Run backend (`make dev-backend`) and frontend (`make dev-frontend`) — the Vite proxy for MCP paths comes in Task 10, so for this smoke test run the backend with `PUBLIC_BASE_URL=http://localhost:8000` and point Claude Code straight at it:

```bash
PUBLIC_BASE_URL=http://localhost:8000 make dev-backend
claude mcp add --transport http skatelab-local http://localhost:8000/mcp
```

Expected: `/mcp` in Claude Code starts the OAuth flow; the browser lands on `http://localhost:8000/autorisation?...` (404 page is expected until Task 9 — just confirm the redirect happened and the backend logged `POST /register 201` and `GET /authorize 302`). Remove with `claude mcp remove skatelab-local`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/mcp backend/app/main.py backend/tests/conftest.py backend/tests/mcp_helpers.py backend/tests/test_mcp_http.py
git commit -m "feat(mcp): endpoint /mcp authentifié, dispatcher ASGI et outil whoami"
```

---

### Task 8: Competition tools, glossary resource and role audit

**Files:**
- Modify: `backend/app/mcp/tools.py`
- Create: `backend/app/mcp/glossary.md`
- Test: `backend/tests/test_mcp_tools.py`

**Interfaces:**
- Consumes: `api_get`, `current_principal` (Task 7), `mcp_http`, `mcp_call`, `tool_json`, `issue_test_tokens` (tests).
- Produces tools: `whoami`, `list_my_skaters`, `search_skaters`, `get_skater`, `get_skater_scores`, `get_skater_elements`, `get_skater_category_results`, `get_skater_seasons`, `list_seasons`, `list_competitions`, `get_competition`, `get_score_elements`, `get_team_scores`, `club_progression_ranking`, `club_benchmarks`, `club_element_mastery`, `competition_club_analysis`; resource `skatelab://glossaire`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_mcp_tools.py
import pytest
import pytest_asyncio

from app.models.competition import Competition
from app.models.score import Score
from app.models.skater import Skater
from tests.mcp_helpers import issue_test_tokens, mcp_call, tool_json

EXPECTED_TOOLS = {
    "whoami", "list_my_skaters", "search_skaters", "get_skater", "get_skater_scores",
    "get_skater_elements", "get_skater_category_results", "get_skater_seasons", "list_seasons",
    "list_competitions", "get_competition", "get_score_elements", "get_team_scores",
    "club_progression_ranking", "club_benchmarks", "club_element_mastery", "competition_club_analysis",
}


@pytest_asyncio.fixture
async def scored(db_session, skater_user_with_skater):
    _, _, linked = skater_user_with_skater
    other = Skater(first_name="Bob", last_name="Martin", club="TestClub")
    comp = Competition(name="Comp", url="http://example.com/tools", season="2025-2026")
    db_session.add_all([other, comp])
    await db_session.flush()
    s1 = Score(competition_id=comp.id, skater_id=linked.id, segment="FS", total_score=40.5,
               elements=[{"name": "2A", "goe": 0.5}], pdf_path="/nowhere.pdf")
    s2 = Score(competition_id=comp.id, skater_id=other.id, segment="FS", total_score=38.0, elements=[])
    db_session.add_all([s1, s2])
    await db_session.commit()
    return comp, linked, other, s1, s2


async def _token(oauth_provider, user):
    return (await issue_test_tokens(oauth_provider, user)).access_token


async def call(mcp_http, token, name, **arguments):
    return await mcp_call(mcp_http, token, "tools/call", {"name": name, "arguments": arguments})


async def test_tools_listed_read_only(mcp_http, oauth_provider, admin_user):
    token = await _token(oauth_provider, admin_user[0])
    tools = (await mcp_call(mcp_http, token, "tools/list"))["tools"]
    assert {t["name"] for t in tools} == EXPECTED_TOOLS
    assert all(t["annotations"]["readOnlyHint"] is True for t in tools)


async def test_glossary_resource(mcp_http, oauth_provider, reader_user):
    token = await _token(oauth_provider, reader_user[0])
    res = await mcp_call(mcp_http, token, "resources/read", {"uri": "skatelab://glossaire"})
    assert "GOE" in res["contents"][0]["text"]


async def test_admin_sees_all_skaters(mcp_http, oauth_provider, admin_user, scored):
    token = await _token(oauth_provider, admin_user[0])
    page = tool_json(await call(mcp_http, token, "search_skaters", query="a"))
    assert page["total"] >= 2


async def test_skater_scores_trimmed(mcp_http, oauth_provider, skater_user_with_skater, scored):
    user, _, linked = skater_user_with_skater
    token = await _token(oauth_provider, user)
    page = tool_json(await call(mcp_http, token, "get_skater_scores", skater_id=linked.id))
    assert page["total"] == 1
    item = page["items"][0]
    assert "pdf_url" not in item and "elements" not in item


async def test_skater_can_read_linked_only(mcp_http, oauth_provider, skater_user_with_skater, scored):
    user, _, linked = skater_user_with_skater
    _, _, other, s1, s2 = scored
    token = await _token(oauth_provider, user)

    assert tool_json(await call(mcp_http, token, "list_my_skaters"))[0]["id"] == linked.id
    assert tool_json(await call(mcp_http, token, "get_skater", skater_id=linked.id))["id"] == linked.id
    assert tool_json(await call(mcp_http, token, "get_score_elements", score_id=s1.id))

    for name, args in [
        ("get_skater", {"skater_id": other.id}),
        ("get_skater_scores", {"skater_id": other.id}),
        ("get_skater_elements", {"skater_id": other.id}),
        ("get_skater_category_results", {"skater_id": other.id}),
        ("get_skater_seasons", {"skater_id": other.id}),
        ("get_score_elements", {"score_id": s2.id}),
        ("search_skaters", {"query": "Bob"}),
        ("list_competitions", {}),
        ("get_competition", {"competition_id": scored[0].id}),
        ("get_team_scores", {"competition_id": scored[0].id}),
        ("club_progression_ranking", {}),
        ("club_element_mastery", {}),
        ("club_benchmarks", {"skating_level": "R1", "age_group": "Minime", "gender": "F"}),
        ("competition_club_analysis", {"competition_id": scored[0].id}),
    ]:
        result = await call(mcp_http, token, name, **args)
        assert result["isError"] is True, name
        assert "Accès refusé" in result["content"][0]["text"], name


async def test_limit_is_capped(mcp_http, oauth_provider, admin_user, scored):
    token = await _token(oauth_provider, admin_user[0])
    page = tool_json(await call(mcp_http, token, "search_skaters", query="", limit=1))
    assert page["returned"] == 1 and page["total"] >= 2
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_tools.py -v`
Expected: FAIL — `tools/list` returns only `whoami`; unknown tool errors.

- [ ] **Step 3: Write the glossary**

```markdown
<!-- backend/app/mcp/glossary.md -->
# Glossaire SkateLab — notation du patinage artistique (ISU / FFSG)

## Score d'un segment
- **Segment** : partie d'une compétition notée séparément — `SP` programme court,
  `FS` programme libre (d'autres codes existent selon les compétitions : un seul
  segment pour beaucoup de catégories régionales).
- **Score total** (`total_score`) = TES + PCS − déductions.
- **TES** (`technical_score`, Technical Element Score) : somme des éléments exécutés.
- **PCS** (`component_score`, Program Component Score) : composantes artistiques,
  chacune notée par les juges puis multipliée par un facteur (`components` :
  `score`, `factor`, notes des juges).
- **Déductions** (`deductions`) : chutes, dépassement de temps, costume…

## Éléments
- Chaque élément (`elements`) a une **valeur de base** (BV), un **GOE** (Grade of
  Execution, bonus/malus de qualité, de −5 à +5 par juge, converti en points) et un
  score final = BV + GOE.
- Codes usuels : sauts `T` (boucle piquée), `S` (salchow), `Lo` (boucle),
  `F` (flip), `Lz` (lutz), `A` (axel), préfixés du nombre de rotations (`2A`, `3Lz`) ;
  combinaisons `3T+2T` ; pirouettes (`USp`, `CSp`, `LSp`, `SSp`, `CCoSp`…, suffixe de
  niveau `B`/`1`–`4`) ; pas `StSq`, chorégraphie `ChSq`.
- Marqueurs d'exécution : `<` sous-rotation, `<<` déclassé, `q` quart, `e` carre
  incorrecte, `!` carre incertaine, `x` bonus de seconde moitié, `*` élément invalide.

## Catégories et résultats
- **Catégorie** (`category`) : niveau + âge + genre, par ex. « Régional 2 Minime Dame ».
  Champs séparés : `skating_level`, `age_group`, `gender`.
- **Résultat par catégorie** (`category-results`) : classement final
  (`overall_rank`), total combiné des segments (`combined_total`), rangs SP/FS.
- **Saison** : `AAAA-AAAA` (septembre → juin), par ex. `2025-2026`.
- **France Clubs** : compétition par équipes ; `team-scores` donne les points
  d'équipe calculés à partir des médianes par catégorie.

## Conseils d'analyse
- Comparez des scores **à catégorie égale** : les barèmes et programmes imposés
  diffèrent d'un niveau à l'autre.
- Une progression se lit sur la saison (`get_skater_seasons`, `get_skater_scores`
  avec `season`) et élément par élément (`get_skater_elements`).
```

- [ ] **Step 4: Implement the tools**

Replace `backend/app/mcp/tools.py` with:

```python
"""Outils MCP (lecture seule, données de compétition).

Chaque outil appelle une route GET existante via `api_get` : les droits sont
ceux de l'application web (un compte skater ne voit que ses patineurs).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import app.database as db_mod
from app.mcp.loopback import api_get, current_principal
from app.models.user import User
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)
MAX_LIMIT = 200
DEFAULT_LIMIT = 50
_UI_ONLY_KEYS = frozenset({"pdf_url", "pdf_path"})
GLOSSARY = (Path(__file__).parent / "glossary.md").read_text(encoding="utf-8")


def _slim(value: Any, drop: frozenset[str] = _UI_ONLY_KEYS) -> Any:
    if isinstance(value, dict):
        return {k: _slim(v, drop) for k, v in value.items() if k not in drop}
    if isinstance(value, list):
        return [_slim(v, drop) for v in value]
    return value


def _page(rows: list, limit: int, drop: frozenset[str] = _UI_ONLY_KEYS) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    return {"total": len(rows), "returned": min(len(rows), limit), "items": _slim(rows[:limit], drop)}


def register_tools(server: MCPServer) -> None:
    @server.resource("skatelab://glossaire", name="glossaire", title="Glossaire de notation",
                     mime_type="text/markdown")
    def glossary() -> str:
        """Vocabulaire de notation (TES, PCS, GOE, codes d'éléments, catégories FFSG)."""
        return GLOSSARY

    @server.tool(annotations=READ_ONLY)
    async def whoami() -> dict:
        """Identité du compte SkateLab connecté (nom, email, rôle).

        Rôles : admin, coach et reader voient les données du club ; skater ne voit
        que ses patineurs rattachés (voir list_my_skaters).
        """
        user_id, _ = current_principal()
        async with db_mod.async_session_factory() as session:
            user = await session.get(User, user_id)
            if user is None:
                raise ToolError("Utilisateur introuvable")
            return {"id": user.id, "display_name": user.display_name, "email": user.email, "role": user.role}

    @server.tool(annotations=READ_ONLY)
    async def list_my_skaters() -> list:
        """Patineurs rattachés au compte (rôle skater). Liste vide pour les autres rôles."""
        return await api_get("/api/me/skaters")

    @server.tool(annotations=READ_ONLY)
    async def search_skaters(query: str = "", club: str | None = None, limit: int = DEFAULT_LIMIT) -> dict:
        """Recherche des patineurs par prénom/nom (sous-chaîne), éventuellement par club."""
        rows = await api_get("/api/skaters/", {"search": query or None, "club": club})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_skater(skater_id: int) -> dict:
        """Fiche d'un patineur (identité, club, licence, date de naissance si connue)."""
        return _slim(await api_get(f"/api/skaters/{skater_id}"))

    @server.tool(annotations=READ_ONLY)
    async def get_skater_scores(skater_id: int, season: str | None = None, include_elements: bool = False,
                                limit: int = DEFAULT_LIMIT) -> dict:
        """Scores d'un patineur par compétition et segment (TES, PCS, déductions, rang).

        `season` au format 2025-2026. Les éléments détaillés sont omis sauf si
        include_elements=true (préférer get_skater_elements ou get_score_elements).
        """
        rows = await api_get(f"/api/skaters/{skater_id}/scores", {"season": season})
        drop = _UI_ONLY_KEYS if include_elements else _UI_ONLY_KEYS | {"elements"}
        return _page(rows, limit, drop)

    @server.tool(annotations=READ_ONLY)
    async def get_skater_elements(skater_id: int, element_type: str | None = None, season: str | None = None,
                                  limit: int = MAX_LIMIT) -> dict:
        """Historique des éléments d'un patineur (valeur de base, GOE, score) ; filtre par type."""
        rows = await api_get(f"/api/skaters/{skater_id}/elements",
                             {"element_type": element_type, "season": season})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_skater_category_results(skater_id: int, season: str | None = None,
                                          limit: int = DEFAULT_LIMIT) -> dict:
        """Classements finaux d'un patineur par catégorie et compétition."""
        rows = await api_get(f"/api/skaters/{skater_id}/category-results", {"season": season})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_skater_seasons(skater_id: int) -> list:
        """Saisons pendant lesquelles le patineur a des résultats."""
        return await api_get(f"/api/skaters/{skater_id}/seasons")

    @server.tool(annotations=READ_ONLY)
    async def list_seasons() -> list:
        """Saisons disponibles dans SkateLab."""
        return await api_get("/api/competitions/seasons")

    @server.tool(annotations=READ_ONLY)
    async def list_competitions(season: str | None = None, club: str | None = None, my_club: bool = False,
                                limit: int = DEFAULT_LIMIT) -> dict:
        """Compétitions importées (nom, dates, lieu, type), filtrables par saison ou club."""
        rows = await api_get("/api/competitions/", {"season": season, "club": club,
                                                    "my_club": "true" if my_club else None})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_competition(competition_id: int) -> dict:
        """Détail d'une compétition et de ses catégories."""
        return _slim(await api_get(f"/api/competitions/{competition_id}"))

    @server.tool(annotations=READ_ONLY)
    async def get_score_elements(score_id: int) -> list:
        """Éléments détaillés d'un score (code, valeur de base, GOE, notes des juges)."""
        return _slim(await api_get(f"/api/scores/{score_id}/elements"))

    @server.tool(annotations=READ_ONLY)
    async def get_team_scores(competition_id: int) -> dict:
        """Points d'équipe d'une compétition France Clubs."""
        return _slim(await api_get(f"/api/competitions/{competition_id}/team-scores"))

    @server.tool(annotations=READ_ONLY)
    async def club_progression_ranking(season: str | None = None, club: str | None = None,
                                       skating_level: str | None = None, age_group: str | None = None,
                                       gender: str | None = None, limit: int = DEFAULT_LIMIT) -> Any:
        """Classement de progression des patineurs du club sur une saison."""
        data = await api_get("/api/stats/progression-ranking", {
            "season": season, "club": club, "skating_level": skating_level,
            "age_group": age_group, "gender": gender})
        return _page(data, limit) if isinstance(data, list) else _slim(data)

    @server.tool(annotations=READ_ONLY)
    async def club_benchmarks(skating_level: str, age_group: str, gender: str, season: str | None = None) -> dict:
        """Repères de score (médianes, quartiles) pour une catégorie donnée."""
        return _slim(await api_get("/api/stats/benchmarks", {
            "skating_level": skating_level, "age_group": age_group, "gender": gender, "season": season}))

    @server.tool(annotations=READ_ONLY)
    async def club_element_mastery(season: str | None = None, club: str | None = None,
                                   skating_level: str | None = None, age_group: str | None = None,
                                   gender: str | None = None) -> Any:
        """Taux de réussite par élément pour le club (GOE moyen, fréquence, erreurs)."""
        return _slim(await api_get("/api/stats/element-mastery", {
            "season": season, "club": club, "skating_level": skating_level,
            "age_group": age_group, "gender": gender}))

    @server.tool(annotations=READ_ONLY)
    async def competition_club_analysis(competition_id: int, club: str | None = None) -> dict:
        """Analyse des résultats du club sur une compétition (progressions, records)."""
        return _slim(await api_get("/api/stats/competition-club-analysis",
                                   {"competition_id": competition_id, "club": club}))
```

- [ ] **Step 5: Run tests**

Run: `cd backend && /opt/homebrew/bin/uv run pytest tests/test_mcp_tools.py -v && /opt/homebrew/bin/uv run pytest -q`
Expected: all PASS. If a tool returns a non-JSON-object (list) and `tool_json` fails on structured wrapping, read `result["structuredContent"]["result"]` instead in `tool_json` — adapt the helper, not the tools. If `test_skater_can_read_linked_only` shows a route that returns 200 for an unlinked skater, **that is a real scoping leak**: fix the route with `require_skater_access` / `reject_skater_role` (as in Task 1) rather than weakening the test.

- [ ] **Step 6: Commit**

```bash
git add backend/app/mcp/tools.py backend/app/mcp/glossary.md backend/tests/test_mcp_tools.py
git commit -m "feat(mcp): outils de compétition en lecture seule et glossaire de notation"
```

---

### Task 9: Frontend — consent page, login return, « Applications connectées »

**Files:**
- Create: `frontend/src/auth/safeNext.ts`, `frontend/src/auth/safeNext.test.ts`, `frontend/src/pages/AuthorizePage.tsx`, `frontend/src/components/ConnectedAppsCard.tsx`
- Modify: `frontend/src/api/client.ts`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: the Task 6 API.
- Produces: `safeNext(next: string | null): string`; `api.oauth.getRequest(id)`, `api.oauth.decide(id, approve)`, `api.oauth.grants(all?)`, `api.oauth.revoke(familyId)`; types `OAuthRequestInfo`, `OAuthGrant`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/auth/safeNext.test.ts
import { describe, expect, it } from "vitest";
import { safeNext } from "./safeNext";

describe("safeNext", () => {
  it("keeps internal paths with query", () => {
    expect(safeNext("/autorisation?demande=abc")).toBe("/autorisation?demande=abc");
  });
  it("falls back to / for missing or external targets", () => {
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && /opt/homebrew/bin/npm test -- safeNext`
Expected: FAIL — cannot resolve `./safeNext`.

- [ ] **Step 3: Implement `safeNext` and wire the login page**

```ts
// frontend/src/auth/safeNext.ts
/** Cible de retour après connexion : chemin interne uniquement (pas de redirection ouverte). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
```

In `frontend/src/pages/LoginPage.tsx`: change the router import to `import { Link, useNavigate, useSearchParams } from "react-router-dom";`, add `import { safeNext } from "../auth/safeNext";`, after `const navigate = useNavigate();` add `const [searchParams] = useSearchParams();` and `const next = safeNext(searchParams.get("next"));`, then replace both `navigate("/", { replace: true });` with `navigate(next, { replace: true });`. Add `next` to the `useCallback` dependency array of `handleGoogleResponse`.

Run: `cd frontend && /opt/homebrew/bin/npm test -- safeNext`
Expected: PASS.

- [ ] **Step 4: API client**

In `frontend/src/api/client.ts`, add the types near the other exported interfaces:

```ts
export interface OAuthRequestInfo {
  request_id: string;
  client_name: string;
  redirect_host: string;
  is_loopback: boolean;
  role: string;
}

export interface OAuthGrant {
  family_id: string;
  client_name: string;
  user_id: string;
  user_display_name: string;
  granted_at: number;
  last_used_at: number | null;
}
```

and inside the `api` object (next to `me:`):

```ts
  oauth: {
    getRequest: (id: string) => request<OAuthRequestInfo>(`/oauth/requests/${encodeURIComponent(id)}`),
    decide: (id: string, approve: boolean) =>
      request<{ redirect_url: string }>("/oauth/consent", {
        method: "POST",
        body: JSON.stringify({ request_id: id, approve }),
      }),
    grants: (all = false) => request<OAuthGrant[]>(`/oauth/grants${all ? "?all=true" : ""}`),
    revoke: (familyId: string) =>
      request<void>(`/oauth/grants/${encodeURIComponent(familyId)}`, { method: "DELETE" }),
  },
```

- [ ] **Step 5: Consent page**

```tsx
// frontend/src/pages/AuthorizePage.tsx
import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function AuthorizePage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("demande") ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data: info, isLoading, isError } = useQuery({
    queryKey: ["oauth-request", requestId],
    queryFn: () => api.oauth.getRequest(requestId),
    enabled: !!user && !!requestId,
    retry: false,
  });

  if (loading) return null;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  async function decide(approve: boolean) {
    setSubmitting(true);
    setError("");
    try {
      const { redirect_url } = await api.oauth.decide(requestId, approve);
      window.location.assign(redirect_url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("409")
          ? "Vous devez d'abord changer votre mot de passe temporaire."
          : msg.includes("404")
          ? "Cette demande a expiré. Relancez la connexion depuis Claude."
          : "Une erreur est survenue."
      );
      setSubmitting(false);
    }
  }

  const scopeText =
    user.role === "skater"
      ? "les résultats de compétition de vos patineurs rattachés"
      : "les résultats de compétition et les statistiques du club";

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-xl shadow-sm p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-6">
          <span className="material-symbols-outlined text-primary text-3xl">key</span>
          <h1 className="font-headline text-xl font-bold text-on-surface">Autoriser l'accès</h1>
        </div>

        {!requestId || isError ? (
          <p className="text-sm text-error">Cette demande a expiré ou est invalide. Relancez la connexion depuis Claude.</p>
        ) : isLoading || !info ? (
          <p className="text-sm text-on-surface-variant">Chargement…</p>
        ) : (
          <>
            <p className="text-sm text-on-surface mb-4">
              <span className="font-bold">{info.client_name}</span> demande un accès en{" "}
              <span className="font-bold">lecture seule</span> à {scopeText}.
            </p>
            <div className="bg-surface-container rounded-lg p-4 text-xs text-on-surface-variant space-y-1 mb-4">
              <p>Connecté en tant que <span className="text-on-surface font-semibold">{user.display_name}</span></p>
              <p>Redirection vers <span className="font-mono text-on-surface">{info.redirect_host}</span></p>
              <p>Les données d'entraînement ne sont jamais partagées.</p>
            </div>
            {info.is_loopback && (
              <p className="text-xs text-error bg-error/10 rounded-lg p-3 mb-4">
                Cette demande provient d'un programme sur votre ordinateur (Claude Code). N'autorisez que si vous
                venez de lancer la connexion vous-même.
              </p>
            )}
            {error && (
              <p className="text-xs text-error mb-4">
                {error}{" "}
                {error.includes("mot de passe") && <Link to="/profil" className="underline">Mon compte</Link>}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => decide(false)}
                disabled={submitting}
                className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container disabled:opacity-50"
              >
                Refuser
              </button>
              <button
                onClick={() => decide(true)}
                disabled={submitting}
                className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50"
              >
                {submitting ? "…" : "Autoriser"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

In `frontend/src/App.tsx`: import `AuthorizePage` (same style as `LoginPage`'s import) and add `<Route path="/autorisation" element={<AuthorizePage />} />` right after `<Route path="/request-account" element={<RequestAccountPage />} />` (top-level, outside the layout).

- [ ] **Step 6: « Applications connectées » card**

```tsx
// frontend/src/components/ConnectedAppsCard.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function formatDate(epoch: number | null): string {
  return epoch ? new Date(epoch * 1000).toLocaleDateString("fr-FR") : "jamais";
}

export default function ConnectedAppsCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [all, setAll] = useState(false);
  const queryClient = useQueryClient();
  const { data: grants = [] } = useQuery({
    queryKey: ["oauth-grants", all],
    queryFn: () => api.oauth.grants(all),
  });
  const revoke = useMutation({
    mutationFn: api.oauth.revoke,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oauth-grants"] }),
  });

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-6 max-w-md mt-6">
      <h2 className="font-headline font-bold text-on-surface text-sm mb-1">Applications connectées</h2>
      <p className="text-xs text-on-surface-variant mb-4">
        Applications (Claude) autorisées à lire vos données de compétition.
      </p>
      {isAdmin && (
        <label className="flex items-center gap-2 text-xs text-on-surface-variant mb-3">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Voir toutes les autorisations du club
        </label>
      )}
      {grants.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Aucune application connectée.</p>
      ) : (
        <ul className="space-y-2">
          {grants.map((g) => (
            <li key={g.family_id} className="flex items-center justify-between bg-surface-container rounded-lg px-3 py-2">
              <div>
                <p className="text-sm text-on-surface">
                  {g.client_name}
                  {all && <span className="text-on-surface-variant"> — {g.user_display_name}</span>}
                </p>
                <p className="text-xs text-on-surface-variant">
                  Autorisé le <span className="font-mono">{formatDate(g.granted_at)}</span> · dernière utilisation{" "}
                  <span className="font-mono">{formatDate(g.last_used_at)}</span>
                </p>
              </div>
              <button
                onClick={() => revoke.mutate(g.family_id)}
                disabled={revoke.isPending}
                className="text-xs font-bold text-error disabled:opacity-50"
              >
                Révoquer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

In `frontend/src/pages/ProfilePage.tsx`: `import ConnectedAppsCard from "../components/ConnectedAppsCard";` and render `<ConnectedAppsCard />` right after each of the two `{preferencesCard}` occurrences.

- [ ] **Step 7: Typecheck, test, build**

Run: `cd frontend && /opt/homebrew/bin/npm test && /opt/homebrew/bin/npm run build`
Expected: tests PASS, `tsc` + Vite build succeed.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(mcp): page de consentement OAuth et applications connectées"
```

---

### Task 10: Proxies, docs and end-to-end verification

**Files:**
- Modify: `frontend/vite.config.ts`, `nginx.conf`, `CLAUDE.md`, `docs/deployment-guide.md`
- Create: `docs/connecter-claude.md`

- [ ] **Step 1: Vite proxy (dev)**

In `frontend/vite.config.ts`, extend `server.proxy`:

```ts
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // MCP + OAuth (servis par le backend, cf. app/mcp/dispatcher.py).
      // Clés regex : « /autorisation » (page React) ne doit PAS être relayée.
      "^/(mcp|authorize|token|register|revoke)(\\?.*)?$": {
        target: "http://localhost:8000",
      },
      "^/\\.well-known/oauth-": {
        target: "http://localhost:8000",
      },
    },
```

(No `changeOrigin` here: the backend ignores Host, and keeping it avoids surprises with the SDK's host checks.)

- [ ] **Step 2: nginx (prod image)**

In `nginx.conf`, before `# SPA fallback`, add:

```nginx
    # MCP (Streamable HTTP) — réponses potentiellement longues, pas de buffering
    location = /mcp {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Serveur d'autorisation OAuth (endpoints à la racine, cf. RFC 8414)
    location ~ ^/(authorize|token|register|revoke)$ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /.well-known/oauth- {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

Validate syntax: `docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" --add-host backend:127.0.0.1 nginx:alpine nginx -t`
Expected: `syntax is ok` / `test is successful`. (If Docker/Colima isn't running, start it with `colima start`, or note the step as not run.)

- [ ] **Step 3: User documentation**

```markdown
<!-- docs/connecter-claude.md -->
# Interroger SkateLab depuis Claude

SkateLab expose un **serveur MCP** : Claude peut lire les résultats de compétition
avec **vos droits** SkateLab (un compte patineur ne voit que ses patineurs
rattachés). Lecture seule ; les données d'entraînement ne sont jamais partagées.

URL du serveur : `https://skatelab.toulouseclubpatinage.com/mcp`

## claude.ai (web, Desktop, mobile)
1. Paramètres → Connecteurs → **Ajouter un connecteur personnalisé**.
2. Nom : `SkateLab` ; URL : l'URL ci-dessus. Laisser les champs OAuth vides.
3. **Se connecter** → la page SkateLab s'ouvre : connectez-vous, puis **Autoriser**.

## Claude Code
```bash
claude mcp add --transport http skatelab https://skatelab.toulouseclubpatinage.com/mcp
```
Puis `/mcp` dans Claude Code → authentifier → autoriser dans le navigateur.

## Révoquer
SkateLab → **Mon compte** → *Applications connectées* → **Révoquer**. Se
déconnecter partout ou changer de mot de passe coupe aussi l'accès.

## Exemples de questions
- « Compare les PCS de <patineur> sur ses trois dernières compétitions. »
- « Quels sauts le club rate le plus en Régional 2 cette saison ? »
```

- [ ] **Step 4: Deployment guide and CLAUDE.md**

In `docs/deployment-guide.md`, add a section « Serveur MCP (Claude) » stating: set `PUBLIC_BASE_URL=https://<domaine>` (exact public URL, no trailing slash, HTTPS) in the backend env — on the GCP VM, in its hand-written `docker-compose.yml` (see `docs/gcp-setup.md` §6); the frontend image's nginx proxies `/mcp`, `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/oauth-*`; Claude connects from `160.79.104.0/21`; link to `docs/connecter-claude.md`.

In `CLAUDE.md`:
- Architecture → Backend: add a bullet « **MCP** : `app/mcp/` — serveur MCP OAuth (SDK `mcp` 2.x). `app.main:app` est un dispatcher ASGI (`McpDispatcher`) : `/mcp`, `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/oauth-*` → app Starlette du SDK ; le reste → `litestar_app`. Les outils appellent les routes GET en in-process (`loopback.api_get`, liste blanche) avec un JWT de 60 s : les droits sont ceux des routes. `PUBLIC_BASE_URL` = issuer. »
- Models: add `OAuthClient, OAuthAuthRequest, OAuthToken`. Routes: add `oauth`.
- Testing: add « `mcp_http` : client vers le dispatcher complet ; `oauth_provider` ; helpers dans `tests/mcp_helpers.py`. »

- [ ] **Step 5: Full verification**

Run: `cd backend && /opt/homebrew/bin/uv run pytest -q` and `cd frontend && /opt/homebrew/bin/npm test && /opt/homebrew/bin/npm run build`
Expected: everything green.

Manual end-to-end (local): `make dev-backend` (default `PUBLIC_BASE_URL=http://localhost:5173`) + `make dev-frontend`, then:

```bash
claude mcp add --transport http skatelab-local http://localhost:5173/mcp
```

In Claude Code run `/mcp` → authenticate → browser opens `http://localhost:5173/autorisation?demande=…` → log in if asked → **Autoriser** → Claude Code shows the server connected; ask « whoami » then « liste les compétitions de la saison 2025-2026 ». Check the profile page lists the grant, revoke it, and confirm the next tool call asks to re-authenticate. Also run MCP Inspector (`npx @modelcontextprotocol/inspector`) against the same URL and confirm tools/resources list. Remove with `claude mcp remove skatelab-local`.

A claude.ai custom-connector test needs a public HTTPS URL (staging or tunnel) — do it on the first deployment and record the result in the PR.

- [ ] **Step 6: Commit**

```bash
git add frontend/vite.config.ts nginx.conf docs/connecter-claude.md docs/deployment-guide.md CLAUDE.md
git commit -m "docs(mcp): proxys MCP/OAuth, guide de connexion Claude et déploiement"
```
