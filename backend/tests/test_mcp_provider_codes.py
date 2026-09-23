import pytest
from pydantic import AnyUrl
from sqlalchemy import select

from mcp.server.auth.provider import AuthorizeError, RegistrationError, TokenError
from mcp.shared.auth import OAuthClientInformationFull

from app.mcp import grants
from app.mcp.oauth_provider import hash_secret
from app.models.oauth import OAuthAuthRequest, OAuthToken
from tests.mcp_helpers import BASE, CLAUDE_REDIRECT, register_test_client, start_authorization


async def test_register_and_get_client(oauth_provider):
    client = await register_test_client(oauth_provider)
    assert client.client_name == "Claude"
    assert type(client).__name__ == "SkatelabClient"


async def test_register_rejects_foreign_redirect(oauth_provider):
    info = OAuthClientInformationFull(client_id="x", redirect_uris=[AnyUrl("https://evil.example/cb")],
                                      token_endpoint_auth_method="none")
    with pytest.raises(RegistrationError) as exc:
        await oauth_provider.register_client(info)
    assert exc.value.error == "invalid_redirect_uri"


async def test_authorize_redirects_to_consent_page(oauth_provider, db_session):
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    req = await db_session.get(OAuthAuthRequest, request_id)
    assert req.resource == f"{BASE}/mcp" and req.user_id is None and req.state == "etat"


async def test_authorize_rejects_other_resource(oauth_provider):
    from mcp.server.auth.provider import AuthorizationParams

    client = await register_test_client(oauth_provider)
    with pytest.raises(AuthorizeError) as exc:
        await oauth_provider.authorize(client, AuthorizationParams(
            state=None, scopes=None, code_challenge="c" * 43, redirect_uri=AnyUrl(CLAUDE_REDIRECT),
            redirect_uri_provided_explicitly=True, resource="https://other.example/mcp"))
    assert exc.value.error == "invalid_target"


async def test_deny_redirects_with_access_denied(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    url = await grants.decide(db_session, request_id, user, approve=False)
    assert url.startswith(CLAUDE_REDIRECT) and "error=access_denied" in url and "state=etat" in url
    assert await db_session.get(OAuthAuthRequest, request_id) is None


async def test_approve_then_exchange_code_once(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    url = await grants.decide(db_session, request_id, user, approve=True)
    code = url.split("code=", 1)[1].split("&", 1)[0]

    auth_code = await oauth_provider.load_authorization_code(client, code)
    assert auth_code.subject == user.id and auth_code.resource == f"{BASE}/mcp"

    token = await oauth_provider.exchange_authorization_code(client, auth_code)
    assert token.access_token and token.refresh_token and token.expires_in == 3600
    rows = (await db_session.execute(select(OAuthToken))).scalars().all()
    assert {r.kind for r in rows} == {"access", "refresh"}
    assert all(r.token_hash != token.access_token for r in rows)  # hashed, never stored raw
    assert any(r.token_hash == hash_secret(token.access_token) for r in rows)

    assert await oauth_provider.load_authorization_code(client, code) is None
    with pytest.raises(TokenError):
        await oauth_provider.exchange_authorization_code(client, auth_code)


async def test_concurrent_exchange_code_only_succeeds_once(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    url = await grants.decide(db_session, request_id, user, approve=True)
    code = url.split("code=", 1)[1].split("&", 1)[0]
    auth_code = await oauth_provider.load_authorization_code(client, code)

    await oauth_provider.exchange_authorization_code(client, auth_code)

    # Deuxième requête concurrente avec le même code déjà chargé : la
    # consommation atomique doit l'empêcher de réussir aussi.
    with pytest.raises(TokenError) as exc:
        await oauth_provider.exchange_authorization_code(client, auth_code)
    assert exc.value.error == "invalid_grant"


async def test_code_bound_to_client(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    other = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    url = await grants.decide(db_session, request_id, user, approve=True)
    code = url.split("code=", 1)[1].split("&", 1)[0]
    assert await oauth_provider.load_authorization_code(other, code) is None


async def test_decide_twice_or_expired_is_not_found(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    await grants.decide(db_session, request_id, user, approve=True)
    with pytest.raises(grants.ConsentError) as exc:
        await grants.decide(db_session, request_id, user, approve=True)
    assert exc.value.reason == "not_found"

    request_id = await start_authorization(oauth_provider, client)
    req = await db_session.get(OAuthAuthRequest, request_id)
    req.expires_at = 0
    await db_session.commit()
    assert await grants.get_pending_request(db_session, request_id) is None


async def test_must_change_password_blocks_consent(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    user.must_change_password = True
    await db_session.commit()
    client = await register_test_client(oauth_provider)
    request_id = await start_authorization(oauth_provider, client)
    with pytest.raises(grants.ConsentError) as exc:
        await grants.decide(db_session, request_id, user, approve=True)
    assert exc.value.reason == "must_change_password"
