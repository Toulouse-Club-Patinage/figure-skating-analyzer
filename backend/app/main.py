import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date as date_type, timedelta
from typing import AsyncGenerator

from litestar import Litestar, get
from litestar.config.cors import CORSConfig
from litestar.static_files import StaticFilesConfig
from sqlalchemy import select

from app.config import ALLOWED_ORIGINS, LOGOS_DIR, PDF_DIR
from app.database import init_db, async_session_factory
from app.auth.guards import auth_guard
from app.services.job_queue import job_queue
from app.services.import_service import run_import, run_enrich
from app.routes.auth import router as auth_router
from app.routes.competitions import router as competitions_router
from app.routes.jobs import router as jobs_router
from app.routes.skaters import router as skaters_router
from app.routes.scores import router as scores_router
from app.routes.dashboard import router as dashboard_router
from app.routes.club_config import router as config_router
from app.routes.users import router as users_router
from app.routes.domains import router as domains_router
from app.routes.admin import router as admin_router
from app.routes.stats import router as stats_router
from app.routes.reports import router as reports_router
from app.routes.me import router as me_router
from app.routes.training import router as training_router
from app.routes.notifications import router as notifications_router
from app.routes.team_scores import router as team_scores_router
from app.routes.program_builder import router as program_builder_router
from app.routes.oauth import router as oauth_router


logger = logging.getLogger(__name__)


def _should_disable_polling(comp, today: date_type | None = None) -> bool:
    """Return True if polling should be auto-disabled for this competition."""
    if today is None:
        today = date_type.today()
    if not comp.date_end:
        return False
    return (comp.date_end + timedelta(days=7)) < today


async def _polling_loop() -> None:
    """Background loop that polls enabled competitions every hour."""
    from app.models.competition import Competition

    while True:
        await asyncio.sleep(3600)
        try:
            async with async_session_factory() as session:
                stmt = select(Competition).where(Competition.polling_enabled == True)  # noqa: E712
                comps = (await session.execute(stmt)).scalars().all()
                today = date_type.today()
                for comp in comps:
                    if _should_disable_polling(comp, today):
                        comp.polling_enabled = False
                        logger.info("Auto-disabled polling for competition %d (%s)", comp.id, comp.name)
                        continue
                    await job_queue.create_job("import", comp.id, trigger="auto")
                    await job_queue.create_job("enrich", comp.id, trigger="auto")
                    logger.info("Polling: submitted import+enrich for competition %d (%s)", comp.id, comp.name)
                await session.commit()
        except Exception:
            logger.exception("Error in polling loop")


@asynccontextmanager
async def lifespan(_: Litestar) -> AsyncGenerator[None, None]:
    await init_db()
    job_queue.set_session_factory(async_session_factory)
    await job_queue.cleanup(days=7)

    async def _handle_job(job: dict) -> dict:
        async with async_session_factory() as session:
            if job["type"] == "import":
                return await run_import(session, job["competition_id"], force=False)
            elif job["type"] == "reimport":
                return await run_import(session, job["competition_id"], force=True)
            elif job["type"] == "enrich":
                return await run_enrich(session, job["competition_id"], force=False)
            else:
                raise ValueError(f"Unknown job type: {job['type']}")

    job_queue.set_handler(_handle_job)
    await job_queue.start_worker()
    polling_task = asyncio.create_task(_polling_loop())
    try:
        yield
    finally:
        polling_task.cancel()
        try:
            await polling_task
        except asyncio.CancelledError:
            pass
        await job_queue.stop_worker()


cors_config = CORSConfig(
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)


@get("/api/health")
async def health_check() -> dict:
    return {"status": "ok"}


app = Litestar(
    route_handlers=[
        health_check,
        auth_router,
        config_router,
        competitions_router,
        skaters_router,
        scores_router,
        dashboard_router,
        users_router,
        domains_router,
        jobs_router,
        admin_router,
        stats_router,
        reports_router,
        me_router,
        training_router,
        notifications_router,
        team_scores_router,
        program_builder_router,
        oauth_router,
    ],
    cors_config=cors_config,
    lifespan=[lifespan],
    before_request=auth_guard,
    static_files_config=[
        StaticFilesConfig(
            directories=[str(LOGOS_DIR)],
            path="/api/logos",
        ),
        StaticFilesConfig(
            directories=[str(PDF_DIR)],
            path="/api/pdfs",
        ),
    ],
)
