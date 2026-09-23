"""Qui a le droit de recevoir un code d'autorisation : uniquement les clients Claude.

Limiter les redirect_uris à Claude empêche un site tiers de s'enregistrer
dynamiquement puis d'hameçonner un consentement SkateLab.
"""
from __future__ import annotations

from urllib.parse import urlsplit

from pydantic import AnyUrl

from mcp.shared.auth import OAuthClientInformationFull

ALLOWED_HTTPS_REDIRECTS = frozenset({
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
})
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1"})


def is_loopback(uri: str) -> bool:
    parts = urlsplit(str(uri))
    return (
        parts.scheme == "http"
        and parts.hostname in LOOPBACK_HOSTS
        and parts.username is None
        and parts.path == "/callback"
        and not parts.query
        and not parts.fragment
    )


def is_allowed_redirect(uri: str) -> bool:
    return str(uri) in ALLOWED_HTTPS_REDIRECTS or is_loopback(uri)


def _without_port(uri: str) -> str:
    parts = urlsplit(str(uri))
    return f"{parts.scheme}://{parts.hostname}{parts.path}"


class SkatelabClient(OAuthClientInformationFull):
    """Client dont les redirections loopback ignorent le port (RFC 8252 §7.3)."""

    def validate_redirect_uri(self, redirect_uri: AnyUrl | None) -> AnyUrl:
        if redirect_uri is not None and is_loopback(str(redirect_uri)):
            target = _without_port(str(redirect_uri))
            for registered in self.redirect_uris or []:
                if is_loopback(str(registered)) and _without_port(str(registered)) == target:
                    return redirect_uri
        return super().validate_redirect_uri(redirect_uri)
