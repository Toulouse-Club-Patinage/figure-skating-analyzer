"""Exécution des jobs de la file : import, réimport, enrichissement, suivi (poll).

Les notifications de résultats sont émises ici, une fois le job terminé, et non
dans `run_import`/`run_enrich` : un job `poll` enchaîne import et enrichissement
pour n'envoyer qu'une notification par utilisateur et par passage.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app import config
from app.models.competition import Competition
from app.services.import_service import run_enrich, run_import
from app.services.notification_service import notify_competition_changes, notify_competition_update


async def handle_job(session: AsyncSession, job: dict) -> dict:
    job_type = job["type"]
    competition_id = job["competition_id"]

    if job_type in ("import", "reimport"):
        result = await run_import(session, competition_id, force=job_type == "reimport")
        changes = result.pop("changes", [])
        await _notify(session, competition_id, changes, import_result=result)
        return result

    if job_type == "enrich":
        result = await run_enrich(session, competition_id, force=False)
        changes = result.pop("changes", [])
        await _notify(session, competition_id, changes)
        return result

    if job_type == "poll":
        imported = await run_import(session, competition_id, force=False)
        import_changes = imported.pop("changes", [])
        try:
            enriched = await run_enrich(session, competition_id, force=False)
        except Exception:
            # L'import est déjà commité : ses changements ne réapparaîtront pas
            # au prochain passage, on les notifie avant de propager l'erreur.
            await _notify(session, competition_id, import_changes, import_result=imported)
            raise
        changes = import_changes + enriched.pop("changes", [])
        await _notify(session, competition_id, changes, import_result=imported)
        return {
            **imported,
            "pdfs_downloaded": enriched["pdfs_downloaded"],
            "scores_enriched": enriched["scores_enriched"],
        }

    raise ValueError(f"Unknown job type: {job_type}")


async def _notify(
    session: AsyncSession,
    competition_id: int,
    changes: list[dict],
    import_result: dict | None = None,
) -> None:
    comp = await session.get(Competition, competition_id)
    if not comp or not comp.polling_enabled:
        return
    if import_result and (import_result["scores_imported"] or import_result["category_results_imported"]):
        await notify_competition_update(session, comp, import_result)
    await notify_competition_changes(session, comp, changes, app_base_url=config.PUBLIC_BASE_URL)
    await session.commit()
