from __future__ import annotations

from litestar import Router, get, patch, post, Request, Response
from litestar.datastructures import UploadFile
from litestar.di import Provide
from litestar.enums import RequestEncodingType
from litestar.exceptions import ClientException
from litestar.params import Body
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import reject_skater_role, require_admin
from app.config import LOGOS_DIR, GOOGLE_CLIENT_ID
from app.database import get_session
from app.models.app_settings import AppSettings


def _obfuscate_email(address: str | None) -> str:
    """Encode l'adresse de support pour qu'elle ne circule jamais en clair.

    Les moissonneurs d'adresses lisent aussi les réponses JSON d'API publiques.
    ROT13 sur les lettres + `@` masqué : ce n'est pas du secret (le front doit
    pouvoir décoder sans clé), mais l'adresse ne ressemble plus à une adresse
    et échappe aux regex de collecte. Le pendant se trouve dans
    `frontend/src/components/SupportLink.tsx`.
    """
    if not address:
        return ""
    out = []
    for c in address:
        if "a" <= c <= "z":
            out.append(chr((ord(c) - 97 + 13) % 26 + 97))
        elif "A" <= c <= "Z":
            out.append(chr((ord(c) - 65 + 13) % 26 + 65))
        else:
            out.append(c)
    return "".join(out).replace("@", "(at)")


@get("/")
async def get_config(request: Request, session: AsyncSession) -> dict:
    reject_skater_role(request)
    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()

    if not settings:
        return {
            "setup_required": True,
            "training_enabled": False,
            "google_client_id": GOOGLE_CLIENT_ID or None,
            "support_email_encoded": "",
        }

    return {
        "setup_required": False,
        "club_name": settings.club_name,
        "club_short": settings.club_short,
        "logo_url": f"/api/logos/{settings.logo_path}" if settings.logo_path else "",
        "current_season": settings.current_season,
        "training_enabled": bool(settings.training_enabled),
        "google_client_id": GOOGLE_CLIENT_ID or None,
        "french_ranking_url": settings.french_ranking_url or "",
        "account_requests_enabled": bool(settings.account_requests_enabled),
        "french_ranking_club_names": settings.french_ranking_club_names or [],
        "support_email_encoded": _obfuscate_email(settings.support_email),
    }


@patch("/")
async def update_config(
    data: dict, request: Request, session: AsyncSession
) -> Response:
    require_admin(request)

    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        raise ClientException(detail="Run setup first", status_code=400)

    if "club_name" in data:
        settings.club_name = data["club_name"]
    if "club_short" in data:
        settings.club_short = data["club_short"]
    if "current_season" in data:
        settings.current_season = data["current_season"]
    if "training_enabled" in data:
        settings.training_enabled = bool(data["training_enabled"])
    if "french_ranking_url" in data:
        settings.french_ranking_url = (data["french_ranking_url"] or "").strip() or None
    if "account_requests_enabled" in data:
        settings.account_requests_enabled = bool(data["account_requests_enabled"])
    if "french_ranking_club_names" in data:
        names = data["french_ranking_club_names"] or []
        settings.french_ranking_club_names = [str(n).strip() for n in names if str(n).strip()]
    if "support_email" in data:
        settings.support_email = (data["support_email"] or "").strip() or None

    await session.commit()
    await session.refresh(settings)

    return Response(
        content={
            "club_name": settings.club_name,
            "club_short": settings.club_short,
            "logo_url": f"/api/logos/{settings.logo_path}" if settings.logo_path else "",
            "current_season": settings.current_season,
            "training_enabled": bool(settings.training_enabled),
            "french_ranking_url": settings.french_ranking_url or "",
            "account_requests_enabled": bool(settings.account_requests_enabled),
            "french_ranking_club_names": settings.french_ranking_club_names or [],
            "support_email": settings.support_email or "",
        },
        status_code=200,
    )


@post("/logo")
async def upload_logo(
    request: Request,
    session: AsyncSession,
    data: UploadFile = Body(media_type=RequestEncodingType.MULTI_PART),
) -> dict:
    require_admin(request)

    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        raise ClientException(detail="Run setup first", status_code=400)

    content = await data.read()
    filename = f"logo{_ext(data.filename or 'logo.png')}"
    path = LOGOS_DIR / filename
    path.write_bytes(content)

    settings.logo_path = filename
    await session.commit()

    return {"logo_url": f"/api/logos/{filename}"}


@get("/smtp")
async def get_smtp_settings(request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        return {"smtp_host": "", "smtp_port": 587, "smtp_user": "", "smtp_from": "", "smtp_from_name": "", "support_email": "", "configured": False}

    return {
        "smtp_host": settings.smtp_host or "",
        "smtp_port": settings.smtp_port or 587,
        "smtp_user": settings.smtp_user or "",
        "smtp_from": settings.smtp_from or "",
        "smtp_from_name": settings.smtp_from_name or "",
        # Adresse de contact affichée aux utilisateurs (endpoint admin : en
        # clair ici, encodée sur `GET /config/` qui est public).
        "support_email": settings.support_email or "",
        "configured": bool(settings.smtp_host),
    }


@patch("/smtp")
async def update_smtp_settings(data: dict, request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        raise ClientException(detail="Run setup first", status_code=400)

    if "smtp_host" in data:
        settings.smtp_host = data["smtp_host"] or None
    if "smtp_port" in data:
        settings.smtp_port = int(data["smtp_port"])
    if "smtp_user" in data:
        settings.smtp_user = data["smtp_user"] or None
    if "smtp_password" in data:
        settings.smtp_password = data["smtp_password"] or None
    if "smtp_from" in data:
        settings.smtp_from = data["smtp_from"] or None
    if "smtp_from_name" in data:
        settings.smtp_from_name = data["smtp_from_name"] or None
    if "support_email" in data:
        settings.support_email = (data["support_email"] or "").strip() or None

    await session.commit()
    await session.refresh(settings)

    return {
        "smtp_host": settings.smtp_host or "",
        "smtp_port": settings.smtp_port or 587,
        "smtp_user": settings.smtp_user or "",
        "smtp_from": settings.smtp_from or "",
        "smtp_from_name": settings.smtp_from_name or "",
        # Adresse de contact affichée aux utilisateurs (endpoint admin : en
        # clair ici, encodée sur `GET /config/` qui est public).
        "support_email": settings.support_email or "",
        "configured": bool(settings.smtp_host),
    }


@post("/smtp-test")
async def test_smtp(data: dict, request: Request, session: AsyncSession) -> Response:
    require_admin(request)

    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings or not settings.smtp_host:
        raise ClientException(detail="SMTP non configuré", status_code=400)

    from app.models.user import User
    from app.services.email_service import send_test_email

    from_addr = settings.smtp_from or settings.smtp_user or ""
    if settings.smtp_from_name and from_addr:
        from_addr = f"{settings.smtp_from_name} <{from_addr}>"
    smtp_cfg = {
        "host": settings.smtp_host,
        "port": settings.smtp_port or 587,
        "user": settings.smtp_user or "",
        "password": settings.smtp_password or "",
        "from_addr": from_addr,
    }

    to = data.get("to")
    if not to:
        user_id = request.scope.get("state", {}).get("user_id")
        user = await session.get(User, user_id) if user_id else None
        to = user.email if user else smtp_cfg["from_addr"]

    ok = await send_test_email(smtp_cfg, to)

    if ok:
        return Response(content={"success": True, "message": f"Email de test envoyé à {to}"}, status_code=200)
    else:
        return Response(content={"success": False, "message": "Échec de l'envoi — vérifiez les paramètres SMTP"}, status_code=200)


@get("/account-requests-enabled")
async def account_requests_enabled(session: AsyncSession) -> dict:
    """Public : dit au front s'il doit afficher le lien de demande de compte."""
    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    return {"enabled": bool(settings and settings.account_requests_enabled)}


def _ext(name: str) -> str:
    return "." + name.rsplit(".", 1)[-1] if "." in name else ".png"


router = Router(
    path="/api/config",
    route_handlers=[
        get_config,
        update_config,
        upload_logo,
        get_smtp_settings,
        update_smtp_settings,
        test_smtp,
        account_requests_enabled,
    ],
    dependencies={"session": Provide(get_session)},
)
