"""Opérations OAuth appelées depuis les routes Litestar (session injectée)."""
from __future__ import annotations

import secrets

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
