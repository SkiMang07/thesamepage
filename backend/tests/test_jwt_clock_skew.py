"""
PostgREST's "JWT issued at future" 401 is retried once (utils.py,
_JwtClockSkewRetryTransport). PRELAUNCH_BACKLOG §7 F; first seen in Sentry
on /api/entitlement right after a browser token refresh.
"""
import json

import httpx

from utils import _JwtClockSkewRetryTransport

FUTURE = b'{"code":"PGRST303","message":"JWT issued at future"}'
EXPIRED = b'{"code":"PGRST301","message":"JWT expired"}'


def _transport(responses):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.read())
        status, body = responses[len(seen) - 1]
        return httpx.Response(status, content=body)

    wrapped = _JwtClockSkewRetryTransport(httpx.MockTransport(handler), delay=0)
    return httpx.Client(transport=wrapped, base_url="https://db.test"), seen


def test_retries_once_and_resends_the_same_body():
    client, seen = _transport([(401, FUTURE), (200, b'{"ok":true}')])
    r = client.post("/rest/v1/rpc/ensure_entitlement", json={"a": 1})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert len(seen) == 2 and seen[0] == seen[1] and json.loads(seen[1]) == {"a": 1}


def test_gives_up_after_one_retry():
    client, seen = _transport([(401, FUTURE), (401, FUTURE), (200, b"{}")])
    r = client.get("/rest/v1/things")
    assert r.status_code == 401 and b"issued at future" in r.content
    assert len(seen) == 2


def test_other_401s_are_not_retried():
    client, seen = _transport([(401, EXPIRED), (200, b"{}")])
    r = client.get("/rest/v1/things")
    assert r.status_code == 401 and b"JWT expired" in r.content
    assert len(seen) == 1


def test_success_passes_straight_through():
    client, seen = _transport([(200, b"[1,2]")])
    assert client.get("/rest/v1/things").json() == [1, 2]
    assert len(seen) == 1
