import pytest
import pytest_asyncio


from tests.mcp_helpers import issue_test_tokens, register_test_client, start_authorization


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_request_details_and_approve(client, oauth_provider, skater_token):
    oc = await register_test_client(oauth_provider)
    rid = await start_authorization(oauth_provider, oc)

    r = await client.get(f"/api/oauth/requests/{rid}", headers=_auth(skater_token))
    assert r.status_code == 200
    body = r.json()
    assert body["client_name"] == "Claude" and body["redirect_host"] == "claude.ai"
    assert body["is_loopback"] is False and body["role"] == "skater"

    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": True}, headers=_auth(skater_token))
    assert r.status_code == 200
    assert r.json()["redirect_url"].startswith("https://claude.ai/api/mcp/auth_callback?code=")


async def test_consent_string_false_does_not_approve(client, oauth_provider, skater_token):
    """M-3 : `approve: "false"` (chaîne non vide, donc truthy) ne doit pas autoriser."""
    oc = await register_test_client(oauth_provider)
    rid = await start_authorization(oauth_provider, oc)

    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": "false"},
                          headers=_auth(skater_token))
    assert r.status_code == 200
    assert "error=access_denied" in r.json()["redirect_url"]
    assert "code=" not in r.json()["redirect_url"]


async def test_loopback_request_is_flagged(client, oauth_provider, admin_token):
    oc = await register_test_client(oauth_provider, redirect="http://localhost:3118/callback")
    rid = await start_authorization(oauth_provider, oc, redirect="http://localhost:3118/callback")
    r = await client.get(f"/api/oauth/requests/{rid}", headers=_auth(admin_token))
    assert r.json()["is_loopback"] is True and r.json()["redirect_host"] == "localhost"


async def test_unknown_request_404(client, admin_token):
    r = await client.get("/api/oauth/requests/nope", headers=_auth(admin_token))
    assert r.status_code == 404
    r = await client.post("/api/oauth/consent", json={"request_id": "nope", "approve": True}, headers=_auth(admin_token))
    assert r.status_code == 404


async def test_consent_requires_login(client, oauth_provider):
    oc = await register_test_client(oauth_provider)
    rid = await start_authorization(oauth_provider, oc)
    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": True})
    assert r.status_code == 401


async def test_must_change_password_409(client, db_session, oauth_provider, admin_user, admin_token):
    user, _ = admin_user
    user.must_change_password = True
    await db_session.commit()
    oc = await register_test_client(oauth_provider)
    rid = await start_authorization(oauth_provider, oc)
    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": True}, headers=_auth(admin_token))
    assert r.status_code == 409


async def test_grants_listing_and_revocation(client, oauth_provider, reader_user, reader_token, admin_token):
    reader, _ = reader_user
    await issue_test_tokens(oauth_provider, reader)

    r = await client.get("/api/oauth/grants", headers=_auth(reader_token))
    assert r.status_code == 200 and len(r.json()) == 1
    family = r.json()[0]["family_id"]

    assert (await client.get("/api/oauth/grants?all=true", headers=_auth(reader_token))).status_code == 403
    assert len((await client.get("/api/oauth/grants?all=true", headers=_auth(admin_token))).json()) == 1

    assert (await client.delete(f"/api/oauth/grants/{family}", headers=_auth(reader_token))).status_code == 204
    assert (await client.get("/api/oauth/grants", headers=_auth(reader_token))).json() == []


async def test_cannot_revoke_someone_elses_grant(client, oauth_provider, admin_user, reader_token):
    admin, _ = admin_user
    await issue_test_tokens(oauth_provider, admin)
    import app.database as db_mod
    from app.mcp import grants

    async with db_mod.async_session_factory() as s:
        family = (await grants.list_grants(s, admin.id))[0]["family_id"]
    assert (await client.delete(f"/api/oauth/grants/{family}", headers=_auth(reader_token))).status_code == 404


async def _granted_scopes(client, oauth_provider, token, *, scopes=None, reg_scope=None):
    from app.mcp.oauth_provider import SCOPES_SUPPORTED
    oc = await register_test_client(oauth_provider, scope=reg_scope or " ".join(SCOPES_SUPPORTED))
    rid = await start_authorization(oauth_provider, oc, scopes=scopes)
    info = (await client.get(f"/api/oauth/requests/{rid}", headers=_auth(token))).json()
    r = await client.post("/api/oauth/consent", json={"request_id": rid, "approve": True}, headers=_auth(token))
    code = r.json()["redirect_url"].split("code=", 1)[1].split("&", 1)[0]
    return info, (await oauth_provider.load_authorization_code(oc, code)).scopes


async def test_admin_consent_keeps_import_scope(client, oauth_provider, admin_token):
    info, scopes = await _granted_scopes(client, oauth_provider, admin_token,
                                         scopes=["skatelab:read", "skatelab:import", "offline_access"])
    assert info["can_import"] is True
    assert "skatelab:import" in scopes


@pytest_asyncio.fixture
async def non_admin_token(request, reader_token, coach_token, skater_token):
    return {"reader": reader_token, "coach": coach_token, "skater": skater_token}[request.param]


@pytest.mark.parametrize("non_admin_token", ["reader", "coach", "skater"], indirect=True)
async def test_non_admin_consent_drops_import_scope(client, oauth_provider, non_admin_token):
    token = non_admin_token
    info, scopes = await _granted_scopes(client, oauth_provider, token,
                                         scopes=["skatelab:read", "skatelab:import", "offline_access"])
    assert info["can_import"] is False
    assert "skatelab:import" not in scopes and "skatelab:read" in scopes


async def test_default_scopes_follow_client_registration(client, oauth_provider, admin_token):
    """Sans scope demandé : les scopes enregistrés par le client (import inclus s'il l'a demandé)."""
    info, scopes = await _granted_scopes(client, oauth_provider, admin_token, scopes=[])
    assert "skatelab:import" in scopes and info["can_import"] is True
    info, scopes = await _granted_scopes(client, oauth_provider, admin_token, scopes=[],
                                         reg_scope="skatelab:read offline_access")
    assert "skatelab:import" not in scopes and info["can_import"] is False
