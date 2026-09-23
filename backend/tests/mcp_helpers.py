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
