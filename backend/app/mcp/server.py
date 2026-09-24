"""Fabrique de l'app MCP (transport Streamable HTTP + serveur d'autorisation)."""
from __future__ import annotations

from starlette.applications import Starlette
from starlette.routing import Route

from app import config
from app.mcp.oauth_provider import IMPORT_SCOPE, SCOPE, SCOPES_SUPPORTED, SkatelabOAuthProvider
from app.mcp.tools import register_tools
from mcp.server.auth.handlers.metadata import MetadataHandler
from mcp.server.auth.routes import build_metadata, cors_middleware, create_protected_resource_routes
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer

INSTRUCTIONS = (
    "Données de compétition de patinage artistique du club (SkateLab) : patineurs, "
    "scores par segment, éléments et GOE, composantes (PCS), résultats par catégorie, "
    "statistiques du club. Lisez la ressource skatelab://glossaire pour le vocabulaire. "
    "Commencez par whoami : un compte « skater » ne voit que ses patineurs rattachés. "
    "Les administrateurs peuvent aussi ajouter des compétitions à importer "
    "(import_competitions, puis get_import_job pour suivre l'import)."
)
TOKEN_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"]


def _auth_server_metadata_route(auth: AuthSettings) -> Route:
    """Métadonnées RFC 8414 du SDK, complétées de « none » (clients publics acceptés)."""
    metadata = build_metadata(auth.issuer_url, auth.service_documentation_url,
                              auth.client_registration_options, auth.revocation_options)
    metadata.token_endpoint_auth_methods_supported = TOKEN_AUTH_METHODS
    metadata.revocation_endpoint_auth_methods_supported = TOKEN_AUTH_METHODS
    return Route(
        "/.well-known/oauth-authorization-server",
        endpoint=cors_middleware(MetadataHandler(metadata).handle, ["GET", "OPTIONS"]),
        methods=["GET", "OPTIONS"],
    )


def _protected_resource_routes(auth: AuthSettings) -> list[Route]:
    """Métadonnées RFC 9728 annonçant aussi skatelab:import.

    Le SDK y met `required_scopes` seul ; or les clients MCP demandent les scopes
    annoncés ici, et n'obtiendraient jamais l'import (retiré ensuite au
    consentement pour les non-admins).
    """
    return create_protected_resource_routes(
        resource_url=auth.resource_server_url,
        authorization_servers=[auth.issuer_url],
        scopes_supported=[SCOPE, IMPORT_SCOPE],
    )


def create_mcp_app(base_url: str | None = None) -> tuple[MCPServer, Starlette]:
    base = (base_url or config.PUBLIC_BASE_URL).rstrip("/")
    auth = AuthSettings(
        issuer_url=base,  # chaîne, pas AnyHttpUrl : sinon un « / » final casse la comparaison d'issuer
        resource_server_url=f"{base}/mcp",
        validate_token_resource=True,
        required_scopes=[SCOPE],
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=SCOPES_SUPPORTED, default_scopes=SCOPES_SUPPORTED),
        revocation_options=RevocationOptions(enabled=True),
    )
    server = MCPServer(
        name="skatelab", title="SkateLab", instructions=INSTRUCTIONS,
        auth_server_provider=SkatelabOAuthProvider(base), auth=auth,
    )
    register_tools(server)
    starlette_app = server.streamable_http_app(
        streamable_http_path="/mcp", stateless_http=True, json_response=True, host="0.0.0.0",
    )
    starlette_app.router.routes[:0] = [_auth_server_metadata_route(auth), *_protected_resource_routes(auth)]
    return server, starlette_app
