"""Guards for the two things that let the API serve requests concurrently.

1. Route handlers are plain `def`. The Supabase client is synchronous, so an
   `async def` handler runs its queries on the event loop and blocks every
   other request in the process until it finishes. A plain `def` handler runs
   on FastAPI's thread pool instead.
2. Per-request Supabase clients share one connection pool but never share
   auth state: each request's JWT lives only on its own session headers.
"""
import ast
import os
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import utils  # noqa: E402

ROUTES = Path(__file__).resolve().parents[1] / "routes"
VERBS = {"get", "post", "put", "patch", "delete"}


def _route_handlers():
    for path in sorted(ROUTES.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for d in node.decorator_list:
                if (
                    isinstance(d, ast.Call)
                    and isinstance(d.func, ast.Attribute)
                    and d.func.attr in VERBS
                    and isinstance(d.func.value, ast.Name)
                    and d.func.value.id == "router"
                ):
                    yield path.name, node
                    break


def test_route_handlers_are_plain_def():
    handlers = list(_route_handlers())
    assert len(handlers) > 100  # sanity: the scan found the routers
    offenders = [f"{f}:{n.name}" for f, n in handlers if isinstance(n, ast.AsyncFunctionDef)]
    assert offenders == [], (
        "These route handlers are `async def`. The Supabase client is synchronous, so they "
        "would block the event loop. Make them plain `def` (read uploads with file.file.read()): "
        + ", ".join(offenders)
    )


def _client_for(monkeypatch, token, user_id):
    # The environment the suite runs in may carry placeholder keys; the
    # Supabase client insists on a JWT-shaped key, so pin a harmless one.
    monkeypatch.setattr(utils.settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(utils.settings, "SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
    monkeypatch.setattr(utils, "verify_token_with_supabase", lambda t: {"id": user_id})
    return utils.get_authenticated_client(f"Bearer {token}")


def test_per_request_clients_share_the_pool_but_not_the_token(monkeypatch):
    uid_a, client_a = _client_for(monkeypatch, "token-a", "user-a")
    uid_b, client_b = _client_for(monkeypatch, "token-b", "user-b")

    session_a = client_a.postgrest.session
    session_b = client_b.postgrest.session

    assert (uid_a, uid_b) == ("user-a", "user-b")
    assert session_a is not session_b
    assert session_a.headers["Authorization"] == "Bearer token-a"
    assert session_b.headers["Authorization"] == "Bearer token-b"
    # Storage is built from options.headers, so it must carry the same token.
    assert client_a.options.headers["Authorization"] == "Bearer token-a"
    assert client_b.options.headers["Authorization"] == "Bearer token-b"
    # Both sessions ride the one shared transport (connection pool + SSL context).
    assert session_a._transport is utils._SUPABASE_TRANSPORT
    assert session_b._transport is utils._SUPABASE_TRANSPORT
    assert client_a.auth._http_client._transport is utils._SUPABASE_TRANSPORT


def test_building_a_request_client_does_not_reload_certificates(monkeypatch):
    import ssl

    loads = []
    original = ssl.SSLContext.load_verify_locations

    def counting(self, *args, **kwargs):
        loads.append(1)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ssl.SSLContext, "load_verify_locations", counting)
    for i in range(5):
        _client_for(monkeypatch, f"token-{i}", f"user-{i}")
    assert loads == []
