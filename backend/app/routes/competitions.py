from __future__ import annotations

from datetime import date as date_type, datetime, timezone

from litestar import Router, get, post, delete, patch, Request
from litestar.di import Provide
from litestar.exceptions import NotFoundException
from sqlalchemy import select, distinct, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import reject_skater_role, require_admin
from app.database import get_session
from app.models.competition import Competition
from app.models.category_result import CategoryResult
from app.models.skater import Skater
from app.models.app_settings import AppSettings


# --- DTOs ---

def competition_to_dict(c: Competition) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "url": c.url,
        "date": c.date.isoformat() if c.date else None,
        "date_end": c.date_end.isoformat() if c.date_end else None,
        "season": c.season,
        "discipline": c.discipline,
        "city": c.city,
        "country": c.country,
        "rink": c.rink,
        "ligue": c.ligue,
        "competition_type": c.competition_type,
        "metadata_confirmed": c.metadata_confirmed,
        "polling_enabled": c.polling_enabled,
        "polling_activated_at": c.polling_activated_at.isoformat() if c.polling_activated_at else None,
    }


# --- Handlers ---

@get("/")
async def list_competitions(
    request: Request,
    session: AsyncSession,
    club: str | None = None,
    season: str | None = None,
    ligue: str | None = None,
    my_club: bool = False,
) -> list[dict]:
    reject_skater_role(request)
    effective_club = club
    if my_club and not club:
        settings_result = await session.execute(select(AppSettings).limit(1))
        settings = settings_result.scalar_one_or_none()
        if settings:
            effective_club = settings.club_short

    stmt = select(Competition).order_by(Competition.date.desc())
    if season:
        stmt = stmt.where(Competition.season == season)
    if ligue:
        stmt = stmt.where(Competition.ligue == ligue)
    if effective_club:
        stmt = (
            stmt
            .join(CategoryResult, CategoryResult.competition_id == Competition.id)
            .join(Skater, Skater.id == CategoryResult.skater_id)
            .where(func.upper(Skater.club) == effective_club.upper())
            .distinct()
        )
    result = await session.execute(stmt)
    return [competition_to_dict(c) for c in result.scalars()]


@get("/{competition_id:int}")
async def get_competition(competition_id: int, request: Request, session: AsyncSession) -> dict:
    reject_skater_role(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    return competition_to_dict(comp)


@post("/")
async def create_competition(data: dict, request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    url = data["url"].strip()
    comp = Competition(
        name=data.get("name", url).strip(),
        url=url,
        date=data.get("date"),
        season=data.get("season"),
        discipline=data.get("discipline"),
    )
    session.add(comp)
    await session.commit()
    await session.refresh(comp)
    return competition_to_dict(comp)


@patch("/{competition_id:int}")
async def update_competition(competition_id: int, data: dict, request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    for field in ("name", "city", "country", "competition_type", "season", "ligue"):
        if field in data:
            setattr(comp, field, data[field])
    comp.metadata_confirmed = True
    await session.commit()
    await session.refresh(comp)
    return competition_to_dict(comp)


@delete("/{competition_id:int}", status_code=204)
async def delete_competition(competition_id: int, request: Request, session: AsyncSession) -> None:
    require_admin(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    await session.delete(comp)
    await session.commit()


@post("/{competition_id:int}/import")
async def import_competition(competition_id: int, request: Request, session: AsyncSession, force: bool = False) -> dict:
    """Submit an import job to the queue. Returns immediately with job info."""
    require_admin(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    from app.services.job_queue import job_queue
    job_type = "reimport" if force else "import"
    return await job_queue.create_job(job_type, competition_id, trigger="manual")


@get("/{competition_id:int}/import-status")
async def get_import_status(competition_id: int, session: AsyncSession) -> dict:
    """Return the last import log for a competition."""
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    if comp.last_import_log is None:
        return {"status": "never_imported"}
    return comp.last_import_log


@post("/{competition_id:int}/enrich")
async def enrich_competition(competition_id: int, request: Request, session: AsyncSession) -> dict:
    """Submit an enrich job to the queue. Returns immediately with job info."""
    require_admin(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    from app.services.job_queue import job_queue
    return await job_queue.create_job("enrich", competition_id, trigger="manual")


@post("/{competition_id:int}/confirm-metadata")
async def confirm_metadata(competition_id: int, request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    comp.metadata_confirmed = True
    await session.commit()
    await session.refresh(comp)
    return competition_to_dict(comp)


@post("/backfill-metadata")
async def backfill_metadata(request: Request, session: AsyncSession) -> dict:
    """Re-fetch index pages and detect metadata for all unconfirmed competitions."""
    require_admin(request)
    import httpx
    from app.services.competition_metadata import detect_metadata
    from app.services.scraper_factory import get_scraper

    result_stmt = select(Competition).where(Competition.metadata_confirmed == False)  # noqa: E712
    comps = (await session.execute(result_stmt)).scalars().all()
    updated = 0

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={"User-Agent": "Mozilla/5.0 (compatible; skating-analyzer/1.0)"},
    ) as client:
        for comp in comps:
            try:
                resp = await client.get(comp.url)
                if resp.status_code != 200:
                    continue
                html = resp.text
                scraper = get_scraper(comp.url)
                comp_info = scraper.parse_competition_info(html)
                if comp_info.date_end and not comp.date_end:
                    comp.date_end = date_type.fromisoformat(comp_info.date_end)
                meta = detect_metadata(
                    comp.url, html,
                    scraped_city=comp_info.city,
                    scraped_country=comp_info.country,
                )
                if meta["competition_type"] and not comp.competition_type:
                    comp.competition_type = meta["competition_type"]
                if meta["city"] and not comp.city:
                    comp.city = meta["city"]
                if meta["country"] and not comp.country:
                    comp.country = meta["country"]
                if meta["season"] and not comp.season:
                    comp.season = meta["season"]
                if comp_info.rink and not comp.rink:
                    comp.rink = comp_info.rink
                if meta.get("ligue") and not comp.ligue:
                    comp.ligue = meta["ligue"]
                updated += 1
            except Exception:
                continue

    await session.commit()
    return {"status": "ok", "competitions_updated": updated}


@post("/bulk-import")
async def bulk_import(data: dict, request: Request, session: AsyncSession) -> dict:
    """Bulk import: create competitions and submit import jobs to the queue."""
    require_admin(request)
    from app.services.job_queue import job_queue

    urls: list[str] = data.get("urls", [])
    enrich: bool = data.get("enrich", False)
    season: str = data.get("season", "")
    discipline: str = data.get("discipline", "")

    # First pass: create any missing competitions and commit so the write
    # transaction is closed before job_queue.create_job opens its own session
    # (SQLite does not support concurrent writers).
    comp_ids = []
    for raw_url in urls:
        url = raw_url.strip()
        existing = await session.execute(
            select(Competition).where(Competition.url == url)
        )
        comp = existing.scalar_one_or_none()
        if not comp:
            comp = Competition(
                name=url, url=url,
                season=season or None, discipline=discipline or None,
            )
            session.add(comp)
            await session.flush()
            await session.refresh(comp)
        comp_ids.append(comp.id)
    await session.commit()

    # Second pass: submit jobs (each create_job opens its own session)
    job_ids = []
    for comp_id in comp_ids:
        job = await job_queue.create_job("import", comp_id, trigger="bulk")
        job_ids.append(job["id"])

        if enrich:
            enrich_job = await job_queue.create_job("enrich", comp_id, trigger="bulk")
            job_ids.append(enrich_job["id"])

    return {"job_ids": job_ids, "total": len(job_ids)}


@post("/bulk-action")
async def bulk_action(data: dict, request: Request, session: AsyncSession) -> dict:
    """Reimport and/or enrich multiple existing competitions at once."""
    require_admin(request)
    from app.services.job_queue import job_queue

    competition_ids: list[int] = data.get("competition_ids", [])
    action: str = data.get("action", "reimport")  # reimport | enrich | reimport+enrich

    if not competition_ids:
        return {"job_ids": [], "total": 0}

    # Validate all IDs exist
    stmt = select(Competition).where(Competition.id.in_(competition_ids))
    result = await session.execute(stmt)
    found_ids = {c.id for c in result.scalars()}
    missing = set(competition_ids) - found_ids
    if missing:
        raise NotFoundException(f"Competitions not found: {sorted(missing)}")

    job_ids = []
    for comp_id in competition_ids:
        if action in ("reimport", "reimport+enrich"):
            job = await job_queue.create_job("reimport", comp_id, trigger="bulk")
            job_ids.append(job["id"])
        if action in ("enrich", "reimport+enrich"):
            job = await job_queue.create_job("enrich", comp_id, trigger="bulk")
            job_ids.append(job["id"])

    return {"job_ids": job_ids, "total": len(job_ids)}


@get("/seasons")
async def list_seasons(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(distinct(Competition.season))
        .where(Competition.season.isnot(None))
        .order_by(Competition.season.desc())
    )
    return [row[0] for row in result]


@post("/{competition_id:int}/polling")
async def toggle_polling(competition_id: int, data: dict, request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise NotFoundException(f"Competition {competition_id} not found")
    enabled = data.get("enabled", False)
    comp.polling_enabled = enabled
    if enabled:
        comp.polling_activated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(comp)
    return competition_to_dict(comp)


router = Router(
    path="/api/competitions",
    route_handlers=[
        list_competitions,
        list_seasons,
        get_competition,
        create_competition,
        update_competition,
        delete_competition,
        import_competition,
        get_import_status,
        enrich_competition,
        confirm_metadata,
        backfill_metadata,
        bulk_import,
        bulk_action,
        toggle_polling,
    ],
    dependencies={"session": Provide(get_session)},
)
