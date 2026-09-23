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
