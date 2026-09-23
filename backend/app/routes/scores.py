from __future__ import annotations

from typing import Optional

from litestar import Request, Router, get
from litestar.di import Provide
from litestar.exceptions import NotFoundException
from litestar.params import Parameter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.guards import linked_skater_ids, require_skater_access
from app.config import PDF_DIR
from app.database import get_session
from app.models.score import Score
from app.models.category_result import CategoryResult


@get("/")
async def list_scores(
    request: Request,
    session: AsyncSession,
    competition_id: Optional[int] = None,
    skater_id: Optional[int] = None,
    segment: Optional[str] = None,
) -> list[dict]:
    stmt = (
        select(Score)
        .options(selectinload(Score.competition), selectinload(Score.skater))
        .order_by(Score.competition_id, Score.segment, Score.rank)
    )
    if competition_id is not None:
        stmt = stmt.where(Score.competition_id == competition_id)
    if skater_id is not None:
        stmt = stmt.where(Score.skater_id == skater_id)
    if segment is not None:
        stmt = stmt.where(Score.segment == segment.upper())

    allowed = await linked_skater_ids(request, session)
    if allowed is not None:
        stmt = stmt.where(Score.skater_id.in_(allowed))

    result = await session.execute(stmt)
    scores = result.scalars().all()
    return [_score_to_dict(s) for s in scores]


def _score_to_dict(s: Score) -> dict:
    return {
        "id": s.id,
        "competition_id": s.competition_id,
        "competition_name": s.competition.name if s.competition else None,
        "competition_date": s.competition.date.isoformat() if s.competition and s.competition.date else None,
        "skater_id": s.skater_id,
        "skater_first_name": s.skater.first_name if s.skater else None,
        "skater_last_name": s.skater.last_name if s.skater else None,
        "skater_nationality": s.skater.nationality if s.skater else None,
        "skater_club": s.club or (s.skater.club if s.skater else None),
        "segment": s.segment,
        "category": s.category,
        "starting_number": s.starting_number,
        "rank": s.rank,
        "total_score": s.total_score,
        "technical_score": s.technical_score,
        "component_score": s.component_score,
        "deductions": s.deductions,
        "components": s.components,
        "elements": s.elements,
        "skating_level": s.skating_level,
        "age_group": s.age_group,
        "gender": s.gender,
        "event_date": s.event_date.isoformat() if s.event_date else None,
        "pdf_url": _pdf_serving_url(s.pdf_path),
    }


def _pdf_serving_url(pdf_path: str | None) -> str | None:
    """Convert an absolute pdf_path to a /api/pdfs/... serving URL."""
    if not pdf_path:
        return None
    from pathlib import Path
    try:
        rel = Path(pdf_path).relative_to(PDF_DIR)
        return f"/api/pdfs/{rel}"
    except ValueError:
        return None


@get("/{score_id:int}/elements")
async def get_score_elements(score_id: int, request: Request, session: AsyncSession) -> list[dict]:
    score = await session.get(Score, score_id)
    if not score:
        raise NotFoundException(f"Score {score_id} not found")
    await require_skater_access(request, score.skater_id, session)
    return score.elements or []


@get("/category-results")
async def list_category_results(
    request: Request,
    session: AsyncSession,
    competition_id: Optional[int] = None,
    skater_id: Optional[int] = None,
) -> list[dict]:
    stmt = (
        select(CategoryResult)
        .options(
            selectinload(CategoryResult.competition),
            selectinload(CategoryResult.skater),
        )
        .order_by(CategoryResult.competition_id, CategoryResult.category, CategoryResult.overall_rank)
    )
    if competition_id is not None:
        stmt = stmt.where(CategoryResult.competition_id == competition_id)
    if skater_id is not None:
        stmt = stmt.where(CategoryResult.skater_id == skater_id)

    allowed = await linked_skater_ids(request, session)
    if allowed is not None:
        stmt = stmt.where(CategoryResult.skater_id.in_(allowed))

    result = await session.execute(stmt)
    return [_category_result_to_dict(cr) for cr in result.scalars().all()]


def _category_result_to_dict(cr: CategoryResult) -> dict:
    return {
        "id": cr.id,
        "competition_id": cr.competition_id,
        "competition_name": cr.competition.name if cr.competition else None,
        "competition_date": cr.competition.date.isoformat() if cr.competition and cr.competition.date else None,
        "skater_id": cr.skater_id,
        "skater_first_name": cr.skater.first_name if cr.skater else None,
        "skater_last_name": cr.skater.last_name if cr.skater else None,
        "skater_nationality": cr.skater.nationality if cr.skater else None,
        "skater_club": cr.club or (cr.skater.club if cr.skater else None),
        "category": cr.category,
        "overall_rank": cr.overall_rank,
        "combined_total": cr.combined_total,
        "segment_count": cr.segment_count,
        "sp_rank": cr.sp_rank,
        "fs_rank": cr.fs_rank,
        "skating_level": cr.skating_level,
        "age_group": cr.age_group,
        "gender": cr.gender,
    }


router = Router(
    path="/api/scores",
    route_handlers=[list_scores, get_score_elements, list_category_results],
    dependencies={"session": Provide(get_session)},
)
