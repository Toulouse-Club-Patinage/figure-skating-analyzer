import pytest_asyncio
from sqlalchemy import select

from app.models.category_result import CategoryResult
from app.models.competition import Competition
from app.models.notification import Notification
from app.models.score import Score
from app.models.skater import Skater
from app.services import import_service
from app.services.name_parser import parse_skater_name
from app.services.site_scraper import ScrapedCategoryResult, ScrapedCompetitionInfo, ScrapedEvent, ScrapedResult

CATEGORY = "R1 Novice Femme"


class FakeScraper:
    def __init__(self, results=(), cat_results=(), events=()):
        self.results = list(results)
        self.cat_results = list(cat_results)
        self.events = list(events)

    async def scrape(self, url):
        return self.events, self.results, self.cat_results, ScrapedCompetitionInfo(), ""


def use_scraper(monkeypatch, scraper):
    monkeypatch.setattr(import_service, "get_scraper", lambda url: scraper)


def sp(**overrides):
    base = dict(
        name="Alice DUPONT", club="TCP", category=CATEGORY, segment="SP", rank=3,
        total_score=42.31, technical_score=22.0, component_score=20.31, deductions=0.0,
    )
    base.update(overrides)
    return ScrapedResult(**base)


def cat(**overrides):
    base = dict(name="Alice DUPONT", club="TCP", category=CATEGORY, overall_rank=2,
                combined_total=118.4, segment_count=2)
    base.update(overrides)
    return ScrapedCategoryResult(**base)


@pytest_asyncio.fixture
async def comp(db_session):
    c = Competition(name="Comp", url="http://example.com/changes/index.htm")
    db_session.add(c)
    await db_session.commit()
    return c


async def test_new_score_is_reported(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()]))
    result = await import_service.run_import(db_session, comp.id)
    [change] = result["changes"]
    assert (change["kind"], change["segment"], change["category"], change["total_score"], change["rank"]) == (
        "new_score", "SP", CATEGORY, 42.31, 3)
    score = (await db_session.execute(select(Score))).scalar_one()
    assert change["skater_id"] == score.skater_id
    assert "changes" not in comp.last_import_log


async def test_rank_only_change_is_silent(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()]))
    await import_service.run_import(db_session, comp.id)
    use_scraper(monkeypatch, FakeScraper([sp(rank=5)]))
    result = await import_service.run_import(db_session, comp.id)
    assert result["changes"] == []
    assert (await db_session.execute(select(Score))).scalar_one().rank == 5


async def test_corrected_score_is_reported_and_saved(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()]))
    await import_service.run_import(db_session, comp.id)
    use_scraper(monkeypatch, FakeScraper([sp(total_score=43.31, technical_score=23.0)]))
    result = await import_service.run_import(db_session, comp.id)
    assert [c["kind"] for c in result["changes"]] == ["score_corrected"]
    assert result["changes"][0]["total_score"] == 43.31
    score = (await db_session.execute(select(Score))).scalar_one()
    assert (score.total_score, score.technical_score) == (43.31, 23.0)


async def test_final_result_only_on_combined_total(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([sp()], [cat()]))
    first = await import_service.run_import(db_session, comp.id)
    assert {c["kind"] for c in first["changes"]} == {"new_score", "final_result"}
    final = next(c for c in first["changes"] if c["kind"] == "final_result")
    assert (final["total_score"], final["rank"], final["segment"]) == (118.4, 2, None)

    use_scraper(monkeypatch, FakeScraper([sp()], [cat(overall_rank=3)]))
    second = await import_service.run_import(db_session, comp.id)
    assert second["changes"] == []

    use_scraper(monkeypatch, FakeScraper([sp()], [cat(combined_total=120.0)]))
    third = await import_service.run_import(db_session, comp.id)
    assert [c["kind"] for c in third["changes"]] == ["final_result"]
    assert (await db_session.execute(select(CategoryResult))).scalar_one().combined_total == 120.0


async def test_category_result_without_total_is_silent(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper([], [cat(combined_total=None)]))
    result = await import_service.run_import(db_session, comp.id)
    assert result["changes"] == []


async def test_run_import_no_longer_notifies(db_session, comp, admin_user, monkeypatch):
    comp.polling_enabled = True
    await db_session.commit()
    use_scraper(monkeypatch, FakeScraper([sp()]))
    await import_service.run_import(db_session, comp.id)
    assert (await db_session.execute(select(Notification))).scalars().all() == []


async def test_sheet_available_reported_once(db_session, comp, monkeypatch, tmp_path):
    first, last = parse_skater_name("Alice DUPONT")
    skater = Skater(first_name=first, last_name=last, club="TCP")
    db_session.add(skater)
    await db_session.flush()
    db_session.add(Score(competition_id=comp.id, skater_id=skater.id, category=CATEGORY,
                         segment="SP", total_score=42.31, rank=3))
    await db_session.commit()

    pdf = tmp_path / "sp.pdf"
    use_scraper(monkeypatch, FakeScraper(events=[ScrapedEvent(category=CATEGORY, segment="Short Program",
                                                              pdf_url="http://example.com/sp.pdf")]))

    async def fake_download(urls, slug):
        return [pdf]

    monkeypatch.setattr(import_service, "download_pdfs", fake_download)
    monkeypatch.setattr(import_service, "parse_elements", lambda path: [
        {"skater_name": "Alice DUPONT", "elements": [{"name": "2A"}], "category_segment": "x"},
    ])
    monkeypatch.setattr(import_service, "extract_segment_code", lambda value: "SP")

    result = await import_service.run_enrich(db_session, comp.id)
    assert [(c["kind"], c["skater_id"], c["segment"], c["total_score"]) for c in result["changes"]] == [
        ("sheet_available", skater.id, "SP", 42.31)]

    again = await import_service.run_enrich(db_session, comp.id)
    assert again["changes"] == []


async def test_enrich_without_pdf_has_no_changes(db_session, comp, monkeypatch):
    use_scraper(monkeypatch, FakeScraper())
    result = await import_service.run_enrich(db_session, comp.id)
    assert result["changes"] == []
