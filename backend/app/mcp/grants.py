"""Opérations OAuth appelées depuis les routes Litestar (session injectée)."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.oauth_provider import CODE_TTL, hash_secret, now, revoke_family
from app.models.oauth import OAuthAuthRequest, OAuthClient, OAuthToken
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
