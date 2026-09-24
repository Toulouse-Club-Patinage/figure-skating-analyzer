"""Appels in-process aux routes existantes, au nom de l'utilisateur du jeton MCP.

Chaque outil passe par ici : les règles d'accès des routes (skater rattaché,
reject_skater_role, require_admin…) s'appliquent donc telles quelles, sans
duplication. Les écritures exigent en plus le scope OAuth correspondant.
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
    r"^/api/jobs/[0-9a-f]{12}$",
))

# Écritures : liste blanche distincte, POST uniquement.
ALLOWED_WRITE_PATHS = tuple(re.compile(p) for p in (
    r"^/api/competitions/bulk-import$",
))


def current_principal() -> tuple[str, str]:
    token = get_access_token()
    if token is None or not token.subject:
        raise ToolError("Session MCP non authentifiée")
    role = (token.claims or {}).get("role")
    if not role:
        raise ToolError("Session MCP non authentifiée")
    return token.subject, role


def require_scope(scope: str) -> None:
    token = get_access_token()
    if token is None or scope not in token.scopes:
        raise ToolError(f"Cette connexion n'a pas l'autorisation « {scope} ». Déconnectez puis "
                        "reconnectez SkateLab dans Claude pour l'accorder (compte administrateur requis).")


def is_allowed_path(path: str) -> bool:
    return any(p.fullmatch(path) for p in ALLOWED_PATHS)


def is_allowed_write_path(path: str) -> bool:
    return any(p.fullmatch(path) for p in ALLOWED_WRITE_PATHS)


async def api_get(path: str, params: dict | None = None) -> Any:
    if not is_allowed_path(path):
        raise ToolError(f"Route non autorisée : {path}")
    query = {k: v for k, v in (params or {}).items() if v is not None}
    return await _call("GET", path, params=query)


async def api_post(path: str, body: dict, *, scope: str) -> Any:
    if not is_allowed_write_path(path):
        raise ToolError(f"Route non autorisée : {path}")
    require_scope(scope)
    return await _call("POST", path, json=body)


async def _call(method: str, path: str, *, params: dict | None = None, json: dict | None = None) -> Any:
    from app.main import litestar_app  # import tardif : app.main importe ce module

    user_id, role = current_principal()
    jwt = create_access_token(user_id=user_id, role=role, expires_seconds=LOOPBACK_JWT_TTL)
    started = time.monotonic()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=litestar_app),
                                 base_url="http://skatelab.internal") as http:
        response = await http.request(method, path, params=params, json=json,
                                      headers={"Authorization": f"Bearer {jwt}"})
    logger.info("mcp user=%s role=%s %s %s %s -> %s (%.0f ms)", user_id, role, method, path,
                params or json, response.status_code, (time.monotonic() - started) * 1000)
    if response.status_code == 403:
        if method != "GET" or path.startswith("/api/jobs/"):
            raise ToolError("Accès refusé : action réservée aux administrateurs du club.")
        raise ToolError("Accès refusé : ces données ne sont pas visibles avec votre compte "
                        "(réservé à l'encadrement du club ou à d'autres patineurs).")
    if response.status_code == 404:
        raise ToolError("Introuvable.")
    if response.status_code >= 400:
        raise ToolError(f"Erreur SkateLab ({response.status_code}).")
    return response.json()
