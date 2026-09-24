"""The default write limit (PRELAUNCH_BACKLOG §7 C).

Every write without its own @limiter.limit gets DEFAULT_WRITE_LIMIT per route
per IP; reads are never throttled by it; and a 429 the middleware returns
still carries CORS headers, which only holds while SlowAPIMiddleware is
registered before CORSMiddleware in main.py.
"""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import utils  # noqa: E402

ORIGIN = main._ALLOWED_ORIGINS[0]


@pytest.fixture
def client():
    utils.limiter.reset()
    yield TestClient(main.app)
    utils.limiter.reset()


def _allowed():
    return int(utils.DEFAULT_WRITE_LIMIT.split("/")[0])


def test_default_limit_is_writes_only():
    (group,) = utils.limiter._default_limits
    assert sorted(group.methods) == ["delete", "patch", "post", "put"]


def test_unlimited_write_route_gets_default_and_429_keeps_cors(client):
    # No bearer token: the read-only gate stands aside and the route answers
    # 401, but the limiter counts the request before the route runs.
    for _ in range(_allowed()):
        r = client.post("/api/direct-reports", json={}, headers={"Origin": ORIGIN})
        assert r.status_code == 401
    r = client.post("/api/direct-reports", json={}, headers={"Origin": ORIGIN})
    assert r.status_code == 429
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_reads_are_not_throttled_by_the_default(client):
    for _ in range(_allowed() + 5):
        r = client.get("/api/direct-reports")
        assert r.status_code == 401
