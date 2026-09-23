from __future__ import annotations

from litestar import Router, get, put, Request
from litestar.di import Provide
from litestar.exceptions import NotFoundException, ClientException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import require_admin, reject_skater_role
from app.database import get_session
from app.models.app_settings import AppSettings
from app.models.competition import Competition
from app.models.score import Score
from app.services.team_scoring import get_team_scores, auto_init_titular, DEFAULT_MEDIANS


@get("/{competition_id:int}/team-scores")
async def get_competition_team_scores(
    competition_id: int, request: Request, session: AsyncSession
) -> dict:
    reject_skater_role(request)
    result = await get_team_scores(session, competition_id)
    if result is None:
        raise NotFoundException("Compétition introuvable ou pas de type France Clubs")
    return result


@get("/{competition_id:int}/team-medians")
async def get_competition_medians(
    competition_id: int, request: Request, session: AsyncSession
) -> dict:
    reject_skater_role(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException("Compétition introuvable")

    if comp.team_medians:
        return {"medians": comp.team_medians, "source": "competition"}

    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    medians = (settings.default_team_medians if settings else None) or DEFAULT_MEDIANS
    return {"medians": medians, "source": "default"}


@put("/{competition_id:int}/team-medians")
async def update_competition_medians(
    data: dict, competition_id: int, request: Request, session: AsyncSession
) -> dict:
    require_admin(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException("Compétition introuvable")

    medians = data.get("medians")
    if not isinstance(medians, dict):
        raise ClientException(detail="Format de médianes invalide", status_code=400)

    comp.team_medians = medians
    await session.commit()
    return {"medians": comp.team_medians, "source": "competition"}


@get("/default-team-medians")
async def get_default_medians(request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    medians = (settings.default_team_medians if settings else None) or DEFAULT_MEDIANS
    return {"medians": medians}


@put("/default-team-medians")
async def update_default_medians(
    data: dict, request: Request, session: AsyncSession
) -> dict:
    require_admin(request)

    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        raise ClientException(detail="Configuration non initialisée", status_code=400)

    medians = data.get("medians")
    if not isinstance(medians, dict):
        raise ClientException(detail="Format de médianes invalide", status_code=400)

    settings.default_team_medians = medians
    await session.commit()
    return {"medians": settings.default_team_medians}


@put("/{competition_id:int}/team-titular/{score_id:int}")
async def update_titular_status(
    competition_id: int, score_id: int, data: dict, request: Request, session: AsyncSession
) -> dict:
    """Toggle is_titular for a specific score in a competition."""
    require_admin(request)

    score = await session.get(Score, score_id)
    if not score or score.competition_id != competition_id:
        raise NotFoundException("Score introuvable pour cette competition")

    is_titular = data.get("is_titular")
    if not isinstance(is_titular, bool):
        raise ClientException(detail="is_titular doit etre un booleen", status_code=400)

    score.is_titular = is_titular
    await session.commit()
    return {"score_id": score.id, "is_titular": score.is_titular}


@put("/{competition_id:int}/team-titular-reset")
async def reset_titular_status(
    competition_id: int, request: Request, session: AsyncSession
) -> dict:
    """Reset all titular statuses to NULL, triggering auto-initialization on next load."""
    require_admin(request)

    comp = await session.get(Competition, competition_id)
    if not comp or comp.competition_type != "france_clubs":
        raise NotFoundException("Competition introuvable ou pas de type France Clubs")

    stmt = (
        select(Score)
        .where(Score.competition_id == competition_id)
    )
    result = await session.execute(stmt)
    scores = result.scalars().all()
    for score in scores:
        score.is_titular = None
    await session.flush()

    # Re-run auto-init
    await auto_init_titular(session, competition_id)
    await session.commit()
    return {"reset": True, "count": len(scores)}


router = Router(
    path="/api/competitions",
    route_handlers=[
        get_competition_team_scores,
        get_competition_medians,
        update_competition_medians,
        get_default_medians,
        update_default_medians,
        update_titular_status,
        reset_titular_status,
    ],
    dependencies={"session": Provide(get_session)},
)
