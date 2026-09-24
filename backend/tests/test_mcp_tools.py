import pytest
import pytest_asyncio

from app.models.competition import Competition
from app.models.score import Score
from app.models.skater import Skater
from tests.mcp_helpers import issue_test_tokens, mcp_call, tool_json

EXPECTED_TOOLS = {
    "whoami", "list_my_skaters", "search_skaters", "get_skater", "get_skater_scores",
    "get_skater_elements", "get_skater_category_results", "get_skater_seasons", "list_seasons",
    "list_competitions", "get_competition", "get_score_elements", "get_team_scores",
    "club_progression_ranking", "club_benchmarks", "club_element_mastery", "competition_club_analysis",
    "get_import_job", "import_competitions",
}
WRITE_TOOLS = {"import_competitions"}


@pytest_asyncio.fixture
async def scored(db_session, skater_user_with_skater):
    _, _, linked = skater_user_with_skater
    other = Skater(first_name="Bob", last_name="Martin", club="TestClub")
    comp = Competition(name="Comp", url="http://example.com/tools", season="2025-2026")
    db_session.add_all([other, comp])
    await db_session.flush()
    s1 = Score(competition_id=comp.id, skater_id=linked.id, segment="FS", total_score=40.5,
               elements=[{"name": "2A", "goe": 0.5}], pdf_path="/nowhere.pdf")
    s2 = Score(competition_id=comp.id, skater_id=other.id, segment="FS", total_score=38.0, elements=[])
    db_session.add_all([s1, s2])
    await db_session.commit()
    return comp, linked, other, s1, s2


async def _token(oauth_provider, user):
    return (await issue_test_tokens(oauth_provider, user)).access_token


async def call(mcp_http, token, name, **arguments):
    return await mcp_call(mcp_http, token, "tools/call", {"name": name, "arguments": arguments})


async def test_tools_listed_read_only(mcp_http, oauth_provider, admin_user):
    token = await _token(oauth_provider, admin_user[0])
    tools = (await mcp_call(mcp_http, token, "tools/list"))["tools"]
    assert {t["name"] for t in tools} == EXPECTED_TOOLS
    assert all(t["annotations"]["readOnlyHint"] is (t["name"] not in WRITE_TOOLS) for t in tools)


async def test_glossary_resource(mcp_http, oauth_provider, reader_user):
    token = await _token(oauth_provider, reader_user[0])
    res = await mcp_call(mcp_http, token, "resources/read", {"uri": "skatelab://glossaire"})
    assert "GOE" in res["contents"][0]["text"]


async def test_admin_sees_all_skaters(mcp_http, oauth_provider, admin_user, scored):
    token = await _token(oauth_provider, admin_user[0])
    page = tool_json(await call(mcp_http, token, "search_skaters", query="a"))
    assert page["total"] >= 2


async def test_skater_scores_trimmed(mcp_http, oauth_provider, skater_user_with_skater, scored):
    user, _, linked = skater_user_with_skater
    token = await _token(oauth_provider, user)
    page = tool_json(await call(mcp_http, token, "get_skater_scores", skater_id=linked.id))
    assert page["total"] == 1
    item = page["items"][0]
    assert "pdf_url" not in item and "elements" not in item


async def test_skater_can_read_linked_only(mcp_http, oauth_provider, skater_user_with_skater, scored):
    user, _, linked = skater_user_with_skater
    _, _, other, s1, s2 = scored
    token = await _token(oauth_provider, user)

    assert tool_json(await call(mcp_http, token, "list_my_skaters"))[0]["id"] == linked.id
    assert tool_json(await call(mcp_http, token, "get_skater", skater_id=linked.id))["id"] == linked.id
    assert tool_json(await call(mcp_http, token, "get_score_elements", score_id=s1.id))

    for name, args in [
        ("get_skater", {"skater_id": other.id}),
        ("get_skater_scores", {"skater_id": other.id}),
        ("get_skater_elements", {"skater_id": other.id}),
        ("get_skater_category_results", {"skater_id": other.id}),
        ("get_skater_seasons", {"skater_id": other.id}),
        ("get_score_elements", {"score_id": s2.id}),
        ("search_skaters", {"query": "Bob"}),
        ("list_competitions", {}),
        ("get_competition", {"competition_id": scored[0].id}),
        ("get_team_scores", {"competition_id": scored[0].id}),
        ("club_progression_ranking", {}),
        ("club_element_mastery", {}),
        ("club_benchmarks", {"skating_level": "R1", "age_group": "Minime", "gender": "F"}),
        ("competition_club_analysis", {"competition_id": scored[0].id}),
    ]:
        result = await call(mcp_http, token, name, **args)
        assert result["isError"] is True, name
        assert "Accès refusé" in result["content"][0]["text"], name


async def test_limit_is_capped(mcp_http, oauth_provider, admin_user, scored):
    token = await _token(oauth_provider, admin_user[0])
    page = tool_json(await call(mcp_http, token, "search_skaters", query="", limit=1))
    assert page["returned"] == 1 and page["total"] >= 2
