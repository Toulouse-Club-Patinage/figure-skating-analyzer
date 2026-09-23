from urllib.parse import parse_qs, urlsplit

from tests.mcp_helpers import CLAUDE_REDIRECT, issue_test_tokens, mcp_call, pkce_pair, tool_json


async def test_unauthenticated_mcp_gets_401_with_resource_metadata(mcp_http):
    r = await mcp_http.post("/mcp", json={})
    assert r.status_code == 401
    assert 'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"' in r.headers["www-authenticate"]


async def test_discovery_documents(mcp_http):
    prm = (await mcp_http.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert prm["resource"] == "http://localhost/mcp"
    assert prm["authorization_servers"] == ["http://localhost"]

    asm = (await mcp_http.get("/.well-known/oauth-authorization-server")).json()
    assert asm["issuer"] == "http://localhost"
    assert asm["registration_endpoint"] == "http://localhost/register"
    assert "none" in asm["token_endpoint_auth_methods_supported"]
    assert asm["code_challenge_methods_supported"] == ["S256"]
    assert "offline_access" in asm["scopes_supported"]


async def test_api_routes_still_served_by_litestar(mcp_http):
    assert (await mcp_http.get("/api/health")).json() == {"status": "ok"}


async def test_register_rejects_foreign_redirect(mcp_http):
    r = await mcp_http.post("/register", json={"redirect_uris": ["https://evil.example/cb"],
                                               "token_endpoint_auth_method": "none"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_redirect_uri"


async def test_register_is_rate_limited(mcp_http, monkeypatch):
    from app.auth.rate_limit import LoginRateLimiter
    import app.mcp.dispatcher as dispatcher

    monkeypatch.setattr(dispatcher, "register_limiter", LoginRateLimiter(max_attempts=1, window_seconds=60))
    body = {"redirect_uris": [CLAUDE_REDIRECT], "token_endpoint_auth_method": "none"}
    assert (await mcp_http.post("/register", json=body)).status_code == 201
    assert (await mcp_http.post("/register", json=body)).status_code == 429


async def test_full_oauth_flow_then_whoami(mcp_http, admin_user, admin_token):
    user, _ = admin_user
    reg = (await mcp_http.post("/register", json={
        "redirect_uris": [CLAUDE_REDIRECT], "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        "client_name": "Claude"})).json()
    verifier, challenge = pkce_pair()

    r = await mcp_http.get("/authorize", params={
        "response_type": "code", "client_id": reg["client_id"], "redirect_uri": CLAUDE_REDIRECT,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz",
        "scope": "skatelab:read offline_access", "resource": "http://localhost/mcp"})
    assert r.status_code == 302
    location = r.headers["location"]
    assert location.startswith("http://localhost/autorisation?demande=")
    request_id = parse_qs(urlsplit(location).query)["demande"][0]

    r = await mcp_http.post("/api/oauth/consent", json={"request_id": request_id, "approve": True},
                            headers={"Authorization": f"Bearer {admin_token}"})
    callback = parse_qs(urlsplit(r.json()["redirect_url"]).query)
    assert callback["state"] == ["xyz"]

    r = await mcp_http.post("/token", data={
        "grant_type": "authorization_code", "code": callback["code"][0], "redirect_uri": CLAUDE_REDIRECT,
        "client_id": reg["client_id"], "code_verifier": verifier, "resource": "http://localhost/mcp"})
    assert r.status_code == 200, r.text
    tokens = r.json()

    me = tool_json(await mcp_call(mcp_http, tokens["access_token"], "tools/call", {"name": "whoami", "arguments": {}}))
    assert me["id"] == user.id and me["role"] == "admin" and me["display_name"] == "Test Admin"

    r = await mcp_http.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                            "client_id": reg["client_id"]})
    assert r.status_code == 200 and r.json()["refresh_token"] != tokens["refresh_token"]

    r = await mcp_http.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                            "client_id": reg["client_id"]})
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


async def test_wrong_pkce_verifier_rejected(mcp_http, admin_token):
    reg = (await mcp_http.post("/register", json={"redirect_uris": [CLAUDE_REDIRECT],
                                                  "token_endpoint_auth_method": "none"})).json()
    _, challenge = pkce_pair()
    r = await mcp_http.get("/authorize", params={
        "response_type": "code", "client_id": reg["client_id"], "redirect_uri": CLAUDE_REDIRECT,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": "s"})
    request_id = parse_qs(urlsplit(r.headers["location"]).query)["demande"][0]
    r = await mcp_http.post("/api/oauth/consent", json={"request_id": request_id, "approve": True},
                            headers={"Authorization": f"Bearer {admin_token}"})
    code = parse_qs(urlsplit(r.json()["redirect_url"]).query)["code"][0]
    r = await mcp_http.post("/token", data={"grant_type": "authorization_code", "code": code,
                                            "redirect_uri": CLAUDE_REDIRECT, "client_id": reg["client_id"],
                                            "code_verifier": pkce_pair()[0]})
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


async def test_token_for_other_resource_rejected(mcp_http, db_session, oauth_provider, admin_user):
    from sqlalchemy import update
    from app.models.oauth import OAuthToken

    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    await db_session.execute(update(OAuthToken).values(resource="https://other.example/mcp"))
    await db_session.commit()
    r = await mcp_http.post("/mcp", json={}, headers={"Authorization": f"Bearer {tok.access_token}"})
    assert r.status_code == 401
