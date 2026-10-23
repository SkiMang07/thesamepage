"""utils.fetch_all against a fake that enforces Supabase's row cap.

Production's Data API returns at most 1,000 rows per request and drops the
rest without an error (checked 2026-10-22). These tests pin both halves: the
helper reads every row in pages, and the overviews that used to read a whole
manager's 1:1 history in one request now see all of it.
"""

from datetime import date, timedelta

from routes.direct_reports import get_team_overview
from routes.one_on_ones import get_one_on_ones_overview
from utils import MAX_ROWS, fetch_all

ME = "manager-1"


class _Not:
    def __init__(self, q):
        self.q = q

    def is_(self, col, _null):
        self.q.filters.append(lambda r, c=col: r.get(c) is not None)
        return self.q


class _Query:
    """Filters, multi-key ordering, offset/limit paging, and the server cap."""

    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.orders = [], []
        self.offset, self.limit_n = 0, None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r, c=col, v=val: r.get(c) == v)
        return self

    def neq(self, col, val):
        self.filters.append(lambda r, c=col, v=val: r.get(c) != v)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r, c=col, v=set(vals): r.get(c) in v)
        return self

    def is_(self, col, _null):
        self.filters.append(lambda r, c=col: r.get(c) is None)
        return self

    @property
    def not_(self):
        return _Not(self)

    def order(self, col, desc=False, **_k):
        self.orders.append((col, desc))
        return self

    def range(self, start, end):
        self.offset, self.limit_n = start, end - start + 1
        return self

    def execute(self):
        self.db.requests.append(self.name)
        rows = [dict(r) for r in self.db.tables.get(self.name, []) if all(f(r) for f in self.filters)]
        # No ORDER BY returns storage order (Postgres promises nothing), so a
        # capped unordered read keeps the oldest rows and loses the newest.
        for col, desc in reversed(self.orders):
            rows.sort(key=lambda r, c=col: str(r.get(c) or ""), reverse=desc)
        rows = rows[self.offset:]
        if self.limit_n is not None:
            rows = rows[: self.limit_n]
        rows = rows[:MAX_ROWS]  # the server cap, applied silently

        class R:
            data = rows

        return R()


class _DB:
    def __init__(self, tables):
        self.tables, self.requests = tables, []

    def table(self, name):
        return _Query(self, name)


def _numbered(n):
    return [{"id": f"row-{i:05d}", "owner_id": ME} for i in range(n)]


def test_the_cap_is_real_without_paging():
    db = _DB({"commitments": _numbered(2500)})
    assert len(db.table("commitments").select("*").execute().data) == MAX_ROWS


def test_fetch_all_reads_every_row_once_in_order():
    db = _DB({"commitments": _numbered(2500)})
    rows = fetch_all(lambda: db.table("commitments").select("*").eq("owner_id", ME).order("id"))
    assert [r["id"] for r in rows] == [f"row-{i:05d}" for i in range(2500)]
    assert len(db.requests) == 3


def test_an_exact_multiple_costs_one_empty_page():
    db = _DB({"commitments": _numbered(2 * MAX_ROWS)})
    assert len(fetch_all(lambda: db.table("commitments").select("*").order("id"))) == 2 * MAX_ROWS
    assert len(db.requests) == 3


def test_a_small_or_empty_result_is_one_request():
    for n in (0, 7):
        db = _DB({"commitments": _numbered(n)})
        assert len(fetch_all(lambda: db.table("commitments").select("*").order("id"))) == n
        assert len(db.requests) == 1


def _year_of_one_on_ones():
    """Two people, 1,500 logged 1:1s between them. Each person's newest
    meeting has an id that sorts past row 1,000, so a single capped read
    can't see it."""
    today = date(2026, 10, 22)
    rows = []
    for i in range(1500):
        rid = "r1" if i % 2 else "r2"
        rows.append({
            "id": f"s-{i:05d}",
            "manager_id": ME,
            "direct_report_id": rid,
            "scheduled_at": (today - timedelta(days=1500 - i)).isoformat(),
            "created_at": "2026-01-01T00:00:00Z",
            "summary": f"talked {i}",
        })
    rows.append({
        "id": "s-open-r1", "manager_id": ME, "direct_report_id": "r1",
        "scheduled_at": None, "created_at": "2026-10-21T00:00:00Z",
        "summary": None, "prep_guide": {"situation_summary": "next time"},
    })
    return rows, (today - timedelta(days=1)).isoformat(), (today - timedelta(days=2)).isoformat()


def _people():
    return [
        {"id": "r1", "name": "Ana", "manager_id": ME, "archived_at": None, "org_units": None},
        {"id": "r2", "name": "Ben", "manager_id": ME, "archived_at": None, "org_units": None},
    ]


def test_team_overview_sees_the_newest_meeting_past_the_cap():
    rows, r1_last, r2_last = _year_of_one_on_ones()
    db = _DB({"direct_reports": _people(), "one_on_ones": rows, "commitments": []})
    out = {r["id"]: r["last_one_on_one_at"] for r in get_team_overview(auth=(ME, db))}
    assert out == {"r1": r1_last, "r2": r2_last}


def test_one_on_ones_overview_sees_the_newest_meeting_and_the_workspace():
    rows, r1_last, r2_last = _year_of_one_on_ones()
    db = _DB({"direct_reports": _people(), "one_on_ones": rows, "commitments": [], "users": [], "organizations": []})
    out = {r["direct_report_id"]: r for r in get_one_on_ones_overview(auth=(ME, db))}
    assert out["r1"]["last_one_on_one_at"] == r1_last
    assert out["r2"]["last_one_on_one_at"] == r2_last
    assert out["r1"]["planned_session"]["id"] == "s-open-r1"
    assert out["r2"]["planned_session"] is None
