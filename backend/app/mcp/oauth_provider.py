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
