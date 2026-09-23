import base64
import hashlib
import secrets
import uuid

from pydantic import AnyUrl

from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull

BASE = "http://localhost"
CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


async def register_test_client(provider, redirect: str = CLAUDE_REDIRECT):
    info = OAuthClientInformationFull(
        client_id=str(uuid.uuid4()),
        client_name="Claude",
        redirect_uris=[AnyUrl(redirect)],
        token_endpoint_auth_method="none",
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        scope="skatelab:read offline_access",
    )
    await provider.register_client(info)
    return await provider.get_client(info.client_id)


async def start_authorization(provider, client, *, redirect: str = CLAUDE_REDIRECT, state: str = "etat",
                              challenge: str | None = None) -> str:
    url = await provider.authorize(client, AuthorizationParams(
        state=state,
        scopes=["skatelab:read", "offline_access"],
        code_challenge=challenge or pkce_pair()[1],
        redirect_uri=AnyUrl(redirect),
        redirect_uri_provided_explicitly=True,
        resource=f"{BASE}/mcp",
    ))
    return url.split("demande=", 1)[1]


async def issue_test_tokens(provider, user):
    """Jetons MCP valides pour `user`, sans passer par le navigateur."""
    import app.database as db_mod
    from app.mcp.oauth_provider import SCOPES_SUPPORTED, now

    client = await register_test_client(provider)
    async with db_mod.async_session_factory() as session:
        token = await provider.issue_tokens(
            session, client_id=client.client_id, user=user, scopes=list(SCOPES_SUPPORTED),
            family_id=secrets.token_urlsafe(16), granted_at=now(),
        )
        await session.commit()
    return token


MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json",
               "mcp-protocol-version": "2025-06-18"}


async def mcp_call(http, token: str, method: str, params: dict | None = None) -> dict:
    r = await http.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
                        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "error" not in body, body
    return body["result"]


def tool_json(result: dict):
    """Contenu JSON d'un résultat d'outil.

    Les outils qui renvoient une liste (list[...]) sont sérialisés par le SDK MCP
    dans `structuredContent: {"result": [...]}` plutôt que dans un unique bloc
    `content[0].text` (qui, pour une liste, est éclaté en plusieurs blocs).
    """
    import json

    assert result["isError"] is False, result
    structured = result.get("structuredContent")
    if structured is not None and "result" in structured:
        return structured["result"]
    return json.loads(result["content"][0]["text"])
