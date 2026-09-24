"""An unhandled error in a route comes back as a JSON 500 WITH CORS headers.

Without the unhandled_errors_as_json middleware in main.py, Starlette's
outermost ServerErrorMiddleware answers with a bare 500 and no CORS headers,
and the browser reports "Failed to fetch" instead of the error.
"""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

ORIGIN = main._ALLOWED_ORIGINS[0]


@main.app.get("/api/__test__/boom")
def _boom():
    raise RuntimeError("kaboom")


@main.app.get("/api/__test__/http-error")
def _http_error():
    raise HTTPException(status_code=404, detail="nope")


def test_unhandled_error_is_json_500_with_cors():
    client = TestClient(main.app)
    r = client.get("/api/__test__/boom", headers={"Origin": ORIGIN})
    assert r.status_code == 500
    assert r.json() == {"detail": main.UNHANDLED_ERROR_DETAIL}
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_http_exceptions_pass_through_untouched():
    client = TestClient(main.app)
    r = client.get("/api/__test__/http-error", headers={"Origin": ORIGIN})
    assert r.status_code == 404
    assert r.json() == {"detail": "nope"}
    assert r.headers.get("access-control-allow-origin") == ORIGIN
