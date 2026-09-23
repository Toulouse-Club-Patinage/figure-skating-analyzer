# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Environment

Local dev runs on **Docker Compose** with a **Colima VM**. The SQLite database lives inside the backend container — direct DB queries must go through `docker compose exec`.

`npm` and `uv` are NOT on the default shell PATH. Use full paths (`/opt/homebrew/bin/npm`, `/opt/homebrew/bin/uv`) or prepend PATH:
```bash
PATH="/opt/homebrew/bin:$PATH" uv run ...
PATH="/opt/homebrew/bin:$PATH" npm ...
```

## Build & Run Commands

```bash
# Backend
make dev-backend                              # Litestar on :8000
cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
make dev-frontend                             # Vite on :5173
cd frontend && npm run dev

# Docker
docker compose up --build                     # Full stack (backend :8000, frontend :80)

# Tests (all backend, in-memory SQLite)
make test
cd backend && uv run pytest -v

# Single test file / specific test
cd backend && uv run pytest tests/test_parser.py -v
cd backend && uv run pytest tests/test_parser.py::test_name -v

# Install deps
cd backend && uv pip install -r requirements.txt
cd frontend && npm install

# IMPORTANT: After changing requirements.txt, regenerate the lock file:
cd backend && uv lock
# The Dockerfile uses uv.lock, NOT requirements.txt directly.
```

## Architecture

### Backend (Python — Litestar + SQLAlchemy async + SQLite)

- **Entry point**: `backend/app/main.py` — registers all routers, CORS, static files, lifespan (DB init + job queue)
- **Database**: `backend/app/database.py` — async SQLAlchemy engine, auto-migration via `ALTER TABLE` for new columns, bootstrap seeds admin user + app settings from env vars on first run
- **Config**: `backend/app/config.py` — all env vars (`DATABASE_URL`, `SECRET_KEY`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAIL`, etc.)
- **Auth**: JWT access tokens + HTTP-only refresh cookies. `auth/guards.py` has `auth_guard` (before_request hook), `require_admin`, `reject_skater_role`, `require_skater_access`
- **Roles**: `admin` (full access), `reader` (browse, no manage), `skater` (sees only linked skaters via `UserSkater` join table), `coach` (training/program builder routes, via `require_coach_or_admin`)
- **Job queue**: `services/job_queue.py` — in-process async queue for import/reimport/enrich jobs. Routes submit jobs, lifespan worker processes them
- **Import pipeline**: URL → `scraper_factory.py` selects scraper → scraper fetches HTML + PDFs → `parser.py` extracts scores → stored in DB. Scrapers in `services/scrapers/` extend `BaseScraper` (ABC)
- **Demande de compte**: formulaire public (`/request-account`) → `services/account_request.py` vérifie la licence contre le cache French Ranking (`services/french_ranking/`, TTL 1h, portage depuis `ligue-app-competitions`) → compte `skater` créé automatiquement + mot de passe temporaire (7 j) par email. Réponse HTTP toujours neutre (pas d'oracle d'énumération). Cas ambigus routés vers validation admin.
- **PDF reports**: `services/report_data.py` + `templates/reports/` (Jinja2 + WeasyPrint)
- **MCP** : `app/mcp/` — serveur MCP OAuth (SDK `mcp` 2.x). `app.main:app` est un dispatcher ASGI (`McpDispatcher`) : `/mcp`, `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/oauth-*` → app Starlette du SDK ; le reste → `litestar_app`. Les outils appellent les routes GET en in-process (`loopback.api_get`, liste blanche) avec un JWT de 60 s : les droits sont ceux des routes. `PUBLIC_BASE_URL` = issuer.

**Models**: Competition, Skater, Score, CategoryResult, User, UserSkater, AllowedDomain, AppSettings, AccountRequest, FrenchRankingEntry, OAuthClient, OAuthAuthRequest, OAuthToken

**Routes** (all under `/api`): auth, competitions, skaters, scores, dashboard, stats, reports, users, admin, domains, club_config, jobs, me, oauth

### Frontend (React + TypeScript + Vite + Tailwind CSS)

- **API layer**: `src/api/client.ts` — all API calls + types, auto token refresh on 401
- **Auth**: `src/auth/AuthContext.tsx` + `ProtectedRoute.tsx` — React context with JWT flow
- **Routing**: React Router in `App.tsx` — role-based: `skater` role sees limited nav (only their linked skaters), `admin`/`reader` get full nav
- **State**: TanStack Query (react-query) for server state
- **Charts**: Recharts (`ScoreChart`, `PCSRadarChart`, `ElementGOEChart`, `ElementDifficultyChart`)
- **Vite proxy**: `/api` → `http://localhost:8000` in dev

### Design System (Kinetic Lens)

- Tailwind CSS only — no component libraries
- **All UI text in French**
- No borders for sectioning — use surface color layering
- Fonts: Manrope (headlines), Inter (body), Material Symbols Outlined (icons)
- Numeric scores use `font-mono`
- Key colors: `on-surface` (#191c1e), `primary` (#2e6385), `error` (#ba1a1a)

## Testing

Tests use pytest-asyncio with in-memory SQLite. Key fixtures in `conftest.py`: `db_session`, `client` (ASGI test client with monkeypatched DB), `admin_user`/`reader_user`/`skater_user_with_skater`, and corresponding `*_token` fixtures. All tests are async by default (`asyncio_mode = "auto"`).
`mcp_http` : client vers le dispatcher complet ; `oauth_provider` ; helpers dans `tests/mcp_helpers.py`.
