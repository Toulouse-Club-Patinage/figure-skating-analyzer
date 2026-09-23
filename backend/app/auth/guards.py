from __future__ import annotations

from litestar import Request
from litestar.exceptions import NotAuthorizedException, PermissionDeniedException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.tokens import decode_token

# Paths that skip JWT auth entirely
_PUBLIC_PREFIXES = ("/api/auth/", "/api/health")
# Exact paths (with or without trailing slash) that are public
_PUBLIC_EXACT = (
    "/api/config",
    "/api/config/",
    "/api/config/account-requests-enabled",
    "/api/config/account-requests-enabled/",
)


async def auth_guard(request: Request) -> None:
    """Litestar before_request hook: validate JWT on non-public routes.

    For public routes, still parses the token if present so that downstream
    handlers can optionally enforce role checks (e.g. PATCH /api/config/).
    """
    path: str = request.scope["path"]
    is_public = any(path.startswith(p) for p in _PUBLIC_PREFIXES) or path in _PUBLIC_EXACT
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = decode_token(token)
            if payload.get("type") == "access":
                request.scope["state"] = {
                    **request.scope.get("state", {}),
                    "user_id": payload["sub"],
                    "user_role": payload["role"],
                }
        except Exception:
            if not is_public:
                raise NotAuthorizedException("Invalid or expired token")
    elif not is_public:
        raise NotAuthorizedException("Missing or invalid Authorization header")


def require_admin(request: Request) -> None:
    """Reusable helper to check admin role. Raises 403 if not admin."""
    if request.scope.get("state", {}).get("user_role") != "admin":
        raise PermissionDeniedException("Admin role required")


def reject_skater_role(request: Request) -> None:
    """Block access for skater role. Raises 403."""
    if request.scope.get("state", {}).get("user_role") == "skater":
        raise PermissionDeniedException("Skater role cannot access this resource")


def require_coach_or_admin(request: Request) -> None:
    """Allow only coach and admin roles. Raises 403 otherwise."""
    role = request.scope.get("state", {}).get("user_role")
    if role not in ("coach", "admin"):
        raise PermissionDeniedException("Coach or admin role required")


async def require_skater_access(request: Request, skater_id: int, session: AsyncSession) -> None:
    """For skater role, verify the user has access to this specific skater."""
    state = request.scope.get("state", {})
    if state.get("user_role") != "skater":
        return  # admin and reader pass through

    from app.models.user_skater import UserSkater
    from sqlalchemy import select

    result = await session.execute(
        select(UserSkater).where(
            UserSkater.user_id == state["user_id"],
            UserSkater.skater_id == skater_id,
        )
    )
    if not result.scalar_one_or_none():
        raise PermissionDeniedException("You do not have access to this skater")


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
