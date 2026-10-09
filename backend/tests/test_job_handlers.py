import pytest
import pytest_asyncio

from app.models.competition import Competition
from app.services import job_handlers


def imp(changes=(), scores=1):
    return {"competition_id": 1, "status": "success", "events_found": 1, "scores_imported": scores,
            "scores_skipped": 0, "category_results_imported": 0, "category_results_skipped": 0,
            "errors": [], "changes": list(changes)}


def enr(changes=()):
    return {"competition_id": 1, "pdfs_downloaded": 1, "scores_enriched": 1, "unmatched": [],
            "errors": [], "changes": list(changes)}


@pytest_asyncio.fixture
async def comp(db_session):
    c = Competition(name="Comp", url="http://example.com/jobs", polling_enabled=True)
    db_session.add(c)
    await db_session.commit()
    return c


@pytest.fixture
def calls(monkeypatch):
    recorded = {"changes": [], "admin": 0}

    async def fake_changes(session, competition, changes, app_base_url=""):
        recorded["changes"].append(list(changes))

    async def fake_admin(session, competition, import_log, app_base_url=""):
        recorded["admin"] += 1

    monkeypatch.setattr(job_handlers, "notify_competition_changes", fake_changes)
    monkeypatch.setattr(job_handlers, "notify_competition_update", fake_admin)
    return recorded


def fake_runs(monkeypatch, import_result=None, enrich_result=None, enrich_error=None):
    async def fake_import(session, competition_id, force=False):
        return dict(import_result or imp())

    async def fake_enrich(session, competition_id, force=False):
        if enrich_error:
            raise enrich_error
        return dict(enrich_result or enr())

    monkeypatch.setattr(job_handlers, "run_import", fake_import)
    monkeypatch.setattr(job_handlers, "run_enrich", fake_enrich)


async def test_poll_notifies_once_with_merged_changes(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]), enr([{"kind": "sheet_available"}]))
    result = await job_handlers.handle_job(db_session, {"type": "poll", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "new_score"}, {"kind": "sheet_available"}]]
    assert calls["admin"] == 1
    assert result["scores_imported"] == 1
    assert result["scores_enriched"] == 1
    assert result["pdfs_downloaded"] == 1
    assert "changes" not in result


async def test_import_job_notifies_its_changes(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]))
    result = await job_handlers.handle_job(db_session, {"type": "import", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "new_score"}]]
    assert "changes" not in result


async def test_enrich_job_notifies_without_admin(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, enrich_result=enr([{"kind": "sheet_available"}]))
    await job_handlers.handle_job(db_session, {"type": "enrich", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "sheet_available"}]]
    assert calls["admin"] == 0


async def test_no_admin_notification_without_new_rows(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp(scores=0))
    await job_handlers.handle_job(db_session, {"type": "import", "competition_id": comp.id})
    assert calls["admin"] == 0


async def test_no_notification_when_not_polled(db_session, comp, calls, monkeypatch):
    comp.polling_enabled = False
    await db_session.commit()
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]))
    await job_handlers.handle_job(db_session, {"type": "reimport", "competition_id": comp.id})
    assert calls["changes"] == []
    assert calls["admin"] == 0


async def test_poll_still_notifies_import_when_enrich_fails(db_session, comp, calls, monkeypatch):
    fake_runs(monkeypatch, imp([{"kind": "new_score"}]), enrich_error=RuntimeError("pdf down"))
    with pytest.raises(RuntimeError):
        await job_handlers.handle_job(db_session, {"type": "poll", "competition_id": comp.id})
    assert calls["changes"] == [[{"kind": "new_score"}]]


async def test_unknown_job_type(db_session, comp, calls):
    with pytest.raises(ValueError):
        await job_handlers.handle_job(db_session, {"type": "nope", "competition_id": comp.id})
