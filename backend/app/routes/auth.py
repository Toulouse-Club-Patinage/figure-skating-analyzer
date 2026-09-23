from __future__ import annotations

import logging

from litestar import Router, Request, post, Response
from litestar.di import Provide
from litestar.exceptions import NotAuthorizedException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timedelta, timezone

from app.auth.passwords import hash_password, verify_password
from app.auth.tokens import create_access_token, create_refresh_token, decode_token
from app.auth.rate_limit import account_request_limiter, login_limiter
from app.config import SECURE_COOKIES, GOOGLE_CLIENT_ID
from app.database import get_session
from app.models.account_request import AccountRequest
from app.models.user import User
from app.models.allowed_domain import AllowedDomain
from app.models.app_settings import AppSettings
from app.services.account_request import process_request

logger = logging.getLogger(__name__)

_NEUTRAL_RESPONSE = {
    "detail": "Si les informations fournies sont valides, vous recevrez un email."
}
_TEMP_PASSWORD_TTL = timedelta(days=7)


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        samesite="lax",
        path="/api/auth/refresh",
        secure=SECURE_COOKIES,
        max_age=604800,  # 7 days
    )


def _user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "must_change_password": user.must_change_password,
        "has_password": user.password_hash is not None,
        "tutorial_seen": user.tutorial_seen_at is not None,
    }


@post("/login")
async def login(data: dict, session: AsyncSession) -> Response:
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not login_limiter.is_allowed(email):
        return Response(
            content={"detail": "Too many login attempts. Try again later."},
            status_code=429,
        )

    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        login_limiter.record(email)
        raise NotAuthorizedException("Invalid email or password")

    if not user.is_active:
        raise NotAuthorizedException("Account is disabled")

    # Mot de passe temporaire périmé : la demande devient caduque (évalué à la
    # connexion, pas de tâche planifiée). Une réinitialisation admin
    # (`temp_password_set_at`) fait repartir le délai.
    if user.must_change_password:
        pending = None
        issued_at = user.temp_password_set_at
        if issued_at is None:
            # `expired` inclus : sinon la tentative suivante passerait.
            pending = (
                await session.execute(
                    select(AccountRequest)
                    .where(
                        AccountRequest.user_id == user.id,
                        AccountRequest.status.in_(("created", "expired")),
                    )
                    .order_by(AccountRequest.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            issued_at = pending.created_at if pending is not None else None
        if issued_at is not None:
            if issued_at.tzinfo is None:
                issued_at = issued_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - issued_at > _TEMP_PASSWORD_TTL:
                if pending is not None and pending.status == "created":
                    pending.status = "expired"
                    await session.commit()
                raise NotAuthorizedException("Temporary password has expired")

    user.last_login_at = datetime.now(timezone.utc)
    await session.commit()

    access = create_access_token(user_id=user.id, role=user.role)
    refresh = create_refresh_token(user_id=user.id, token_version=user.token_version)

    response = Response(
        content={"access_token": access, "user": _user_dict(user)},
        status_code=200,
    )
    _set_refresh_cookie(response, refresh)
    return response


@post("/refresh")
async def refresh(request: Request, session: AsyncSession) -> Response:
    cookie_token = request.cookies.get("refresh_token")
    if not cookie_token:
        raise NotAuthorizedException("No refresh token")

    try:
        payload = decode_token(cookie_token)
    except Exception:
        raise NotAuthorizedException("Invalid refresh token")

    if payload.get("type") != "refresh":
        raise NotAuthorizedException("Invalid token type")

    result = await session.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise NotAuthorizedException("User not found or disabled")

    if user.token_version != payload.get("ver"):
        raise NotAuthorizedException("Token revoked")

    access = create_access_token(user_id=user.id, role=user.role)
    response = Response(
        content={"access_token": access, "user": _user_dict(user)},
        status_code=200,
    )
    return response


@post("/logout")
async def logout(request: Request, session: AsyncSession) -> Response:
    cookie_token = request.cookies.get("refresh_token")
    if cookie_token:
        try:
            payload = decode_token(cookie_token)
            result = await session.execute(select(User).where(User.id == payload["sub"]))
            user = result.scalar_one_or_none()
            if user:
                user.token_version += 1
                await session.commit()
        except Exception:
            pass

    response = Response(content={"detail": "Logged out"}, status_code=200)
    response.delete_cookie(key="refresh_token", path="/api/auth/refresh")
    return response


@post("/setup")
async def setup(data: dict, session: AsyncSession) -> Response:
    """First-run setup: create initial admin + app settings."""
    result = await session.execute(select(User).limit(1))
    if result.scalar_one_or_none() is not None:
        return Response(
            content={"detail": "Setup already completed"},
            status_code=403,
        )

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    display_name = data.get("display_name", "").strip()
    club_name = data.get("club_name", "").strip()
    club_short = data.get("club_short", "").strip()

    if not email or not password or not display_name or not club_name or not club_short:
        return Response(
            content={"detail": "All fields are required"},
            status_code=400,
        )

    if len(password) < 8:
        return Response(
            content={"detail": "Password must be at least 8 characters"},
            status_code=400,
        )

    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=display_name,
        role="admin",
    )
    session.add(user)

    settings = AppSettings(
        club_name=club_name,
        club_short=club_short,
        current_season="2025-2026",
    )
    session.add(settings)
    await session.commit()
    await session.refresh(user)

    access = create_access_token(user_id=user.id, role=user.role)
    refresh = create_refresh_token(user_id=user.id, token_version=user.token_version)

    response = Response(
        content={"access_token": access, "user": _user_dict(user)},
        status_code=201,
    )
    _set_refresh_cookie(response, refresh)
    return response


@post("/google")
async def google_login(data: dict, session: AsyncSession) -> Response:
    """Google OAuth: verify ID token, match or create user."""
    try:
        if not GOOGLE_CLIENT_ID:
            return Response(
                content={"detail": "Google OAuth not configured"},
                status_code=400,
            )

        id_token_str = data.get("credential", "")
        if not id_token_str:
            return Response(content={"detail": "Missing credential"}, status_code=400)

        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        try:
            idinfo = google_id_token.verify_oauth2_token(
                id_token_str, google_requests.Request(), GOOGLE_CLIENT_ID
            )
        except Exception as e:
            logger.exception("Google token verification failed")
            raise NotAuthorizedException(f"Invalid Google token: {e}")

        email = idinfo.get("email", "").lower()
        if not email:
            raise NotAuthorizedException("No email in Google token")

        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user:
            if not user.is_active:
                raise NotAuthorizedException("Account is disabled")
            user.google_oauth_enabled = True
            user.last_login_at = datetime.now(timezone.utc)
            await session.commit()
        else:
            domain = email.split("@")[1] if "@" in email else ""
            result = await session.execute(
                select(AllowedDomain).where(AllowedDomain.domain == domain)
            )
            if result.scalar_one_or_none() is None:
                return Response(
                    content={"detail": "Email domain not allowed"},
                    status_code=403,
                )
            user = User(
                email=email,
                display_name=idinfo.get("name", email.split("@")[0]),
                role="reader",
                google_oauth_enabled=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)

        access = create_access_token(user_id=user.id, role=user.role)
        refresh = create_refresh_token(user_id=user.id, token_version=user.token_version)

        response = Response(
            content={"access_token": access, "user": _user_dict(user)},
            status_code=200,
        )
        _set_refresh_cookie(response, refresh)
        return response
    except Exception:
        logger.exception("Google login endpoint failed")
        raise


@post("/change-password")
async def change_password(data: dict, request: Request, session: AsyncSession) -> Response:
    # Manually validate JWT since /api/auth/* is public
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise NotAuthorizedException("Missing or invalid Authorization header")

    token = auth_header[7:]
    try:
        payload = decode_token(token)
    except Exception:
        raise NotAuthorizedException("Invalid or expired token")

    if payload.get("type") != "access":
        raise NotAuthorizedException("Invalid token type")

    user_id = payload["sub"]

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotAuthorizedException("User not found")

    if not user.password_hash:
        return Response(
            content={"detail": "OAuth-only account cannot change password"},
            status_code=400,
        )

    current_password = data.get("current_password", "")
    new_password = data.get("new_password", "")

    if not verify_password(current_password, user.password_hash):
        return Response(
            content={"detail": "Current password is incorrect"},
            status_code=401,
        )

    if len(new_password) < 8:
        return Response(
            content={"detail": "Password must be at least 8 characters"},
            status_code=400,
        )

    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.token_version += 1
    await session.commit()
    await session.refresh(user)

    access = create_access_token(user_id=user.id, role=user.role)
    refresh = create_refresh_token(user_id=user.id, token_version=user.token_version)

    response = Response(
        content={"access_token": access, "user": _user_dict(user)},
        status_code=200,
    )
    _set_refresh_cookie(response, refresh)
    return response


@post("/request-account")
async def request_account(data: dict, request: Request, session: AsyncSession) -> Response:
    """Demande publique de création de compte.

    La réponse est TOUJOURS identique (202) quel que soit le résultat : sans
    cela, le endpoint permettrait d'énumérer les licences du club.
    """
    settings = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    if settings is None or not settings.account_requests_enabled:
        return Response(
            content={"detail": "Les demandes de compte ne sont pas activées."},
            status_code=403,
        )

    email = str(data.get("email", "")).strip().lower()
    display_name = str(data.get("display_name", "")).strip()
    licences = data.get("licences") or []

    if not email or not display_name or not isinstance(licences, list) or not licences:
        return Response(
            content={"detail": "Email, nom et au moins une licence sont requis."},
            status_code=400,
        )

    client_ip = request.client.host if request.client else "inconnu"
    for key in (email, client_ip):
        if not account_request_limiter.is_allowed(key):
            return Response(
                content={"detail": "Trop de demandes. Réessayez plus tard."},
                status_code=429,
            )
    for key in (email, client_ip):
        account_request_limiter.record(key)

    try:
        await process_request(
            session, email, display_name, licences, datetime.now(timezone.utc)
        )
    except Exception:
        logger.exception("Échec du traitement d'une demande de compte")

    return Response(content=_NEUTRAL_RESPONSE, status_code=202)


router = Router(
    path="/api/auth",
    route_handlers=[
        login,
        refresh,
        logout,
        setup,
        google_login,
        change_password,
        request_account,
    ],
    dependencies={"session": Provide(get_session)},
)
