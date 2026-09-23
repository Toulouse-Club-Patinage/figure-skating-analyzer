from __future__ import annotations

from datetime import datetime, timezone

from litestar import Router, get, post, patch, delete, Request, Response
from litestar.di import Provide
from litestar.exceptions import NotFoundException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import require_admin
from app.auth.passwords import hash_password
from app.database import get_session
from app.models.app_settings import AppSettings
from app.models.user_skater import UserSkater
from app.services.account_request import generate_temp_password
from app.services.email_service import get_smtp_config, send_email


async def _sync_skater_links(session: AsyncSession, user_id: str, skater_ids: list[int]) -> None:
    """Replace all user_skater links for a user."""
    existing = await session.execute(
        select(UserSkater).where(UserSkater.user_id == user_id)
    )
    for link in existing.scalars().all():
        await session.delete(link)
    await session.flush()
    for sid in skater_ids:
        session.add(UserSkater(user_id=user_id, skater_id=sid))


@get("/")
async def list_users(request: Request, session: AsyncSession) -> list[dict]:
    require_admin(request)
    from app.models.user import User

    result = await session.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()

    us_result = await session.execute(select(UserSkater))
    all_links = us_result.scalars().all()
    links_by_user: dict[str, list[int]] = {}
    for link in all_links:
        links_by_user.setdefault(link.user_id, []).append(link.skater_id)

    return [
        {
            "id": u.id,
            "email": u.email,
            "display_name": u.display_name,
            "role": u.role,
            "is_active": u.is_active,
            "google_oauth_enabled": u.google_oauth_enabled,
            "skater_ids": links_by_user.get(u.id, []),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        }
        for u in users
    ]


@post("/")
async def create_user(data: dict, request: Request, session: AsyncSession) -> Response:
    require_admin(request)
    from app.models.user import User

    email = data.get("email", "").strip().lower()
    display_name = data.get("display_name", "").strip()
    role = data.get("role", "reader")
    password = data.get("password")

    if not email or not display_name:
        return Response(content={"detail": "email and display_name required"}, status_code=400)

    # must_change_password only applies if a password is provided
    must_change = data.get("must_change_password", False) and password

    user = User(
        email=email,
        display_name=display_name,
        role=role,
        password_hash=hash_password(password) if password else None,
        must_change_password=bool(must_change),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    skater_ids = data.get("skater_ids", [])
    if role == "skater" and skater_ids:
        await _sync_skater_links(session, user.id, skater_ids)
        await session.commit()

    return Response(
        content={
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
            "is_active": user.is_active,
            "google_oauth_enabled": user.google_oauth_enabled,
            "skater_ids": skater_ids if role == "skater" else [],
        },
        status_code=201,
    )


@patch("/{user_id:str}")
async def update_user(
    user_id: str, data: dict, request: Request, session: AsyncSession
) -> dict:
    require_admin(request)
    from app.models.user import User

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User not found")

    old_role = user.role

    if "role" in data:
        user.role = data["role"]
    if "display_name" in data:
        user.display_name = data["display_name"]
    if "is_active" in data:
        user.is_active = data["is_active"]
        if not data["is_active"]:
            user.token_version += 1

    # Handle skater_ids
    if "skater_ids" in data and user.role == "skater":
        await _sync_skater_links(session, user.id, data["skater_ids"])
    elif old_role == "skater" and user.role != "skater":
        await _sync_skater_links(session, user.id, [])

    await session.commit()
    await session.refresh(user)

    # Load skater_ids for response
    us_result = await session.execute(
        select(UserSkater).where(UserSkater.user_id == user.id)
    )
    skater_ids = [link.skater_id for link in us_result.scalars().all()]

    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "is_active": user.is_active,
        "google_oauth_enabled": user.google_oauth_enabled,
        "skater_ids": skater_ids,
    }


@delete("/{user_id:str}", status_code=200)
async def delete_user(
    user_id: str, request: Request, session: AsyncSession
) -> Response:
    require_admin(request)
    from app.models.user import User

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User not found")

    if user.role == "admin":
        count_result = await session.execute(
            select(func.count()).select_from(User).where(
                User.role == "admin", User.id != user_id
            )
        )
        if count_result.scalar() == 0:
            return Response(
                content={"detail": "Cannot delete the last admin user"},
                status_code=400,
            )

    # Explicitly delete UserSkater links (SQLite FK cascade unreliable)
    existing_links = await session.execute(
        select(UserSkater).where(UserSkater.user_id == user_id)
    )
    for link in existing_links.scalars().all():
        await session.delete(link)

    await session.delete(user)
    await session.commit()
    return Response(content=None, status_code=204)


@post("/{user_id:str}/reset-password", status_code=200)
async def reset_password(
    user_id: str, data: dict, request: Request, session: AsyncSession
) -> dict:
    """Pose un mot de passe temporaire et le renvoie une seule fois à l'admin.

    Recours quand l'email n'arrive pas : l'admin le transmet par un autre canal.
    """
    require_admin(request)
    from app.models.user import User

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise NotFoundException("User not found")

    temp_password = generate_temp_password()
    user.password_hash = hash_password(temp_password)
    user.must_change_password = True
    user.temp_password_set_at = datetime.now(timezone.utc)
    user.token_version += 1  # déconnecte les sessions ouvertes
    await session.commit()

    email_sent = False
    if data.get("send_email"):
        smtp = await get_smtp_config(session)
        if smtp:
            settings = (
                await session.execute(select(AppSettings).limit(1))
            ).scalar_one_or_none()
            club_name = settings.club_name if settings else "SkateLab"
            email_sent = await send_email(
                to=user.email,
                subject=f"Nouveau mot de passe — {club_name}",
                template_name="password_reset.html",
                context={
                    "club_name": club_name,
                    "display_name": user.display_name,
                    "email": user.email,
                    "temp_password": temp_password,
                },
                smtp_config=smtp,
            )

    return {"temp_password": temp_password, "email_sent": email_sent}


router = Router(
    path="/api/users",
    route_handlers=[list_users, create_user, update_user, delete_user, reset_password],
    dependencies={"session": Provide(get_session)},
)
