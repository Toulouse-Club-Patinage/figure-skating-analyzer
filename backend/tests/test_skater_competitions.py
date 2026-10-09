import pytest_asyncio

from app.models.category_result import CategoryResult
from app.models.competition import Competition
from app.models.score import Score
from app.models.skater import Skater


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def comps(db_session, skater_user_with_skater):
    """`mine` : le patineur lié a un score ; `cat_only` : seulement un classement ;
    `other` : uniquement un patineur non lié."""
    _, _, linked = skater_user_with_skater
    stranger = Skater(first_name="Bob", last_name="Martin", club="TestClub")
    mine = Competition(name="Mine", url="http://example.com/mine")
    cat_only = Competition(name="CatOnly", url="http://example.com/cat")
    other = Competition(name="Other", url="http://example.com/other")
    db_session.add_all([stranger, mine, cat_only, other])
    await db_session.flush()
    db_session.add_all([
        Score(competition_id=mine.id, skater_id=linked.id, segment="FS"),
        CategoryResult(competition_id=cat_only.id, skater_id=linked.id, category="R1"),
        Score(competition_id=other.id, skater_id=stranger.id, segment="FS"),
    ])
    await db_session.commit()
    return mine, cat_only, other


async def test_skater_lists_only_competitions_with_own_results(client, skater_token, comps):
    mine, cat_only, other = comps
    r = await client.get("/api/competitions/", headers=_auth(skater_token))
    assert r.status_code == 200
    assert {c["id"] for c in r.json()} == {mine.id, cat_only.id}


async def test_skater_gets_own_competition_detail(client, skater_token, comps):
    mine, *_ = comps
    r = await client.get(f"/api/competitions/{mine.id}", headers=_auth(skater_token))
    assert r.status_code == 200
    assert r.json()["name"] == "Mine"


async def test_skater_forbidden_on_other_competition(client, skater_token, comps):
    *_, other = comps
    r = await client.get(f"/api/competitions/{other.id}", headers=_auth(skater_token))
    assert r.status_code == 403


async def test_skater_forbidden_on_unknown_competition(client, skater_token, comps):
    r = await client.get("/api/competitions/999999", headers=_auth(skater_token))
    assert r.status_code == 403


async def test_reader_still_lists_all_competitions(client, reader_token, comps):
    r = await client.get("/api/competitions/", headers=_auth(reader_token))
    assert {c["name"] for c in r.json()} >= {"Mine", "CatOnly", "Other"}
