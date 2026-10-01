"""Guard: backend/scripts/reset_persona_account.sql must cover every table.

The script wipes a test persona's rows in reverse FK order. A table added to
database/schema.sql but not to the script would leave orphan rows (and, worse,
block "delete the login"). This test fails the moment that happens.

It reads two files and needs no database:
  - database/schema.sql                      tables and their foreign keys
  - backend/scripts/reset_persona_account.sql  the `delete from <table>` lines
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCHEMA = REPO / "database" / "schema.sql"
SCRIPT = REPO / "backend" / "scripts" / "reset_persona_account.sql"

# Not deleted from by name: `users` is kept (reset) or cascades from
# auth.users (delete login); `organizations` is deleted last, after the
# users.org_id unlink, and is asserted separately below.
KEPT = {"users"}


def _strip_sql_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def _schema_tables() -> dict[str, str]:
    """table name -> its column/constraint body, from `create table` blocks."""
    sql = _strip_sql_comments(SCHEMA.read_text())
    tables = {}
    for m in re.finditer(
        r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\((.*?)\n\)\s*;",
        sql,
        re.I | re.S,
    ):
        tables[m.group(1).lower()] = m.group(2)
    return tables


def _script_deletes() -> list[str]:
    """Tables in `delete from <table>` order. Ignores auth.users."""
    sql = _strip_sql_comments(SCRIPT.read_text())
    return [
        t.lower()
        for t in re.findall(r"^\s*delete\s+from\s+(?!auth\.)(?:public\.)?(\w+)", sql, re.I | re.M)
    ]


def test_schema_parses_to_a_plausible_table_count():
    # Catches the parser silently matching nothing after a formatting change.
    assert len(_schema_tables()) >= 60


def test_script_deletes_from_every_schema_table():
    missing = sorted(set(_schema_tables()) - KEPT - set(_script_deletes()))
    assert not missing, (
        "database/schema.sql has tables that backend/scripts/reset_persona_account.sql "
        f"never deletes from: {missing}. Add a `delete from` line for each, "
        "children before parents."
    )


def test_script_names_no_table_the_schema_lacks():
    unknown = sorted(set(_script_deletes()) - set(_schema_tables()))
    assert not unknown, f"Script deletes from tables not in schema.sql (renamed or dropped?): {unknown}"


def test_organizations_is_deleted_last():
    assert _script_deletes()[-1] == "organizations"


def test_children_are_deleted_before_their_parents():
    """For every FK with no ON DELETE rule, the child's delete comes first."""
    order = {t: i for i, t in enumerate(_script_deletes())}
    problems = []
    for child, body in _schema_tables().items():
        if child not in order:
            continue
        for line in body.split("\n"):
            m = re.search(r"references\s+(?:public\.)?(\w+)\s*\(", line, re.I)
            if not m:
                continue
            parent = m.group(1).lower()
            if parent == child or parent not in order:
                continue
            if re.search(r"on\s+delete\s+(cascade|set\s+null)", line, re.I):
                continue  # the database handles it, order doesn't matter
            if order[child] > order[parent]:
                problems.append(f"{child} must be deleted before {parent}")
    assert not problems, "Delete order breaks a foreign key: " + "; ".join(sorted(set(problems)))
