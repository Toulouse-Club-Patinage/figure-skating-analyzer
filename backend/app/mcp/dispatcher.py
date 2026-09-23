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
