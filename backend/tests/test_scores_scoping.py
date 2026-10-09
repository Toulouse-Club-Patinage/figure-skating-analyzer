import pytest_asyncio

from app.config import PDF_DIR
from app.models.category_result import CategoryResult
from app.models.competition import Competition
from app.models.score import Score
from app.models.skater import Skater


@pytest_asyncio.fixture
async def two_skaters_scored(db_session, skater_user_with_skater):
    _, _, linked = skater_user_with_skater
    other = Skater(first_name="Bob", last_name="Martin", club="TestClub")
    comp = Competition(name="Comp", url="http://example.com/scoping")
    db_session.add_all([other, comp])
    await db_session.flush()
    linked_score = Score(competition_id=comp.id, skater_id=linked.id, segment="FS", elements=[{"name": "2A"}])
    other_score = Score(
        competition_id=comp.id, skater_id=other.id, segment="FS",
        elements=[{"name": "3S"}],
        components={"CO": {"score": 3.4, "factor": 1.0, "judges": [3.25, 3.5]}},
        pdf_path=str(PDF_DIR / "scoping" / "other.pdf"),
    )
    db_session.add_all([
        linked_score, other_score,
        CategoryResult(competition_id=comp.id, skater_id=linked.id, category="R1"),
        CategoryResult(competition_id=comp.id, skater_id=other.id, category="R1"),
    ])
    await db_session.commit()
    return comp, linked, other, linked_score, other_score


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_skater_sees_full_ranking_of_own_competition(client, skater_token, two_skaters_scored):
    comp, linked, other, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/?competition_id={comp.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    rows = {s["skater_id"]: s for s in r.json()}
    assert set(rows) == {linked.id, other.id}
    assert rows[linked.id]["is_own"] is True
    assert rows[linked.id]["elements"] == [{"name": "2A"}]
    assert rows[other.id]["is_own"] is False
    assert rows[other.id]["elements"] is None
    assert rows[other.id]["pdf_url"] is None
    assert rows[other.id]["components"] == {"CO": 3.4}


async def test_skater_sees_full_category_results_of_own_competition(client, skater_token, two_skaters_scored):
    comp, linked, other, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/category-results?competition_id={comp.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    flags = {c["skater_id"]: c["is_own"] for c in r.json()}
    assert flags == {linked.id: True, other.id: False}


async def test_skater_without_competition_filter_sees_only_linked(client, skater_token, two_skaters_scored):
    _, linked, *_ = two_skaters_scored
    r = await client.get("/api/scores/", headers=_auth(skater_token))
    assert {s["skater_id"] for s in r.json()} == {linked.id}
    r = await client.get("/api/scores/category-results", headers=_auth(skater_token))
    assert {c["skater_id"] for c in r.json()} == {linked.id}


async def test_skater_gets_nothing_from_foreign_competition(client, db_session, skater_token, two_skaters_scored):
    _, _, other, *_ = two_skaters_scored
    foreign = Competition(name="Foreign", url="http://example.com/foreign")
    db_session.add(foreign)
    await db_session.flush()
    db_session.add(Score(competition_id=foreign.id, skater_id=other.id, segment="FS"))
    await db_session.commit()
    r = await client.get(f"/api/scores/?competition_id={foreign.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    assert r.json() == []


async def test_skater_elements_of_linked_score_ok(client, skater_token, two_skaters_scored):
    *_, linked_score, _ = two_skaters_scored
    r = await client.get(f"/api/scores/{linked_score.id}/elements", headers=_auth(skater_token))
    assert r.status_code == 200


async def test_skater_elements_of_other_score_forbidden(client, skater_token, two_skaters_scored):
    *_, other_score = two_skaters_scored
    r = await client.get(f"/api/scores/{other_score.id}/elements", headers=_auth(skater_token))
    assert r.status_code == 403


async def test_skater_team_routes_forbidden(client, skater_token, two_skaters_scored):
    comp, *_ = two_skaters_scored
    for path in (f"/api/competitions/{comp.id}/team-scores", f"/api/competitions/{comp.id}/team-medians"):
        r = await client.get(path, headers=_auth(skater_token))
        assert r.status_code == 403, path


async def test_reader_still_sees_all_scores(client, reader_token, two_skaters_scored):
    comp, linked, other, *_ = two_skaters_scored
    r = await client.get(f"/api/scores/?competition_id={comp.id}", headers=_auth(reader_token))
    assert {s["skater_id"] for s in r.json()} == {linked.id, other.id}
    assert all(s["is_own"] for s in r.json())
