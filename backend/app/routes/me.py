from __future__ import annotations

import logging
from datetime import datetime, timezone

from litestar import Router, Response, get, patch, post, Request
from litestar.di import Provide
from litestar.exceptions import PermissionDeniedException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rate_limit import skater_attach_limiter
from app.database import get_session
from app.models.user_skater import UserSkater
from app.models.skater import Skater
from app.models.user import User
from app.services.account_request import attach_skater

logger = logging.getLogger(__name__)

# Messages rendus à l'utilisateur : ils ne disent jamais si une licence existe,
# seulement si le couple licence + naissance qu'il a fourni correspond.
_ATTACH_MESSAGES = {
    "created": "Patineur rattaché à votre compte.",
    "already_linked": "Ce patineur est déjà rattaché à votre compte.",
    "pending_admin": (
        "Votre demande a été transmise à un administrateur pour vérification."
    ),
    "rejected": (
        "Aucun patineur de ce club ne correspond au numéro de licence et à la "
        "date de naissance fournis."
    ),
}


@get("/skaters")
async def my_skaters(request: Request, session: AsyncSession) -> list[dict]:
    """Return skaters linked to the current user. Empty list for non-skater roles."""
    state = request.scope.get("state", {})
    if state.get("user_role") != "skater":
        return []

    user_id = state["user_id"]
    stmt = (
        select(Skater)
        .join(UserSkater, UserSkater.skater_id == Skater.id)
        .where(UserSkater.user_id == user_id)
        .order_by(Skater.first_name)
    )
    result = await session.execute(stmt)
    skaters = result.scalars().all()
    return [
        {
            "id": s.id,
            "first_name": s.first_name,
            "last_name": s.last_name,
            "club": s.club,
        }
        for s in skaters
    ]


@post("/skaters/attach")
async def attach_my_skater(request: Request, session: AsyncSession, data: dict) -> Response:
    """Rattache un patineur supplémentaire au compte connecté.

    Le formulaire public ne sert qu'à la création : ce endpoint est le chemin
    d'un parent dont un second enfant prend une licence en cours de saison.
    """
    state = request.scope.get("state", {})
    if state.get("user_role") != "skater":
        raise PermissionDeniedException(
            "Seuls les comptes patineur gèrent leur liste de patineurs."
        )

    licence_number = str(data.get("licence_number", "")).strip()
    birth_date = str(data.get("birth_date", "")).strip()
    if not licence_number or not birth_date:
        return Response(
            content={"detail": "Numéro de licence et date de naissance sont requis."},
            status_code=400,
        )

    user = await session.get(User, state["user_id"])

    if not skater_attach_limiter.is_allowed(user.id):
        return Response(
            content={"detail": "Trop de tentatives. Réessayez plus tard."},
            status_code=429,
        )
    skater_attach_limiter.record(user.id)

    try:
        result = await attach_skater(
            session, user, licence_number, birth_date, datetime.now(timezone.utc)
        )
    except Exception:
        logger.exception("Échec du rattachement d'un patineur pour %s", user.id)
        return Response(
            content={"detail": "Le rattachement a échoué. Réessayez plus tard."},
            status_code=500,
        )

    return Response(
        content={
            "status": result.status,
            "detail": _ATTACH_MESSAGES.get(result.status, _ATTACH_MESSAGES["rejected"]),
            "skater": (
                {
                    "id": result.skater.id,
                    "first_name": result.skater.first_name,
                    "last_name": result.skater.last_name,
                }
                if result.status == "created" and result.skater
                else None
            ),
        },
        status_code=200,
    )


@patch("/preferences")
async def update_preferences(request: Request, session: AsyncSession, data: dict) -> dict:
    state = request.scope.get("state", {})
    user_id = state.get("user_id")
    if not user_id:
        raise PermissionDeniedException("Not authenticated")

    user = await session.get(User, user_id)
    if "email_notifications" in data:
        user.email_notifications = bool(data["email_notifications"])
    if data.get("tutorial_seen"):
        user.tutorial_seen_at = datetime.now(timezone.utc)
    await session.commit()
    return {
        "email_notifications": user.email_notifications,
        "tutorial_seen": user.tutorial_seen_at is not None,
    }


router = Router(
    path="/api/me",
    route_handlers=[my_skaters, attach_my_skater, update_preferences],
    dependencies={"session": Provide(get_session)},
)
