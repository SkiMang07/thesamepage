"""
Proves delete_my_account() removes every row an account owns, and nothing else.

Run it against a throwaway local Postgres after schema.sql (see the usage
notes at the top of database/local_verify_stub.sql), whenever a table is added
or a foreign key changes:

    python3 database/checks/account_deletion_check.py "dbname=tsp_verify user=postgres"

What it does, with no hand-written fixtures so a new table can't be missed:

1. Seeds two accounts, A and B, each with its own login, users row and org.
2. Walks every table in public in foreign-key order and inserts one row per
   account, every foreign key (nullable ones too) pointing at that account's
   own rows. Values for NOT NULL columns are generated from the column type;
   a CHECK constraint that rejects a value is read and satisfied from its
   IN-list / ARRAY[...] literals.
3. Calls delete_my_account() as A, under `set role authenticated`.
4. Fails if any of A's rows survive, if any of B's rows are gone, if A's
   login or org survive, or if the tombstone row is missing.

A table it cannot seed fails the check too: extend the value rules here
rather than skipping it.
"""
import re
import sys
import uuid
from collections import defaultdict

import psycopg
from psycopg import sql

SKIP = {"organizations", "users", "deleted_accounts", "test_account_patterns"}  # seeded by hand / under test / config
# Mirrors EXPORT_EXCLUDED in backend/routes/account.py.
NOT_EXPORTED = {"ai_jobs", "deleted_accounts", "test_account_patterns", "users", "organizations"}


def load_catalog(cur):
    cur.execute(
        """
        select c.relname from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        """
    )
    tables = [r[0] for r in cur.fetchall()]
    cur.execute(
        """
        select table_name, column_name, data_type, udt_name, is_nullable = 'YES',
               column_default, is_identity = 'YES' or is_generated = 'ALWAYS'
        from information_schema.columns
        where table_schema = 'public' order by table_name, ordinal_position
        """
    )
    cols = defaultdict(list)
    for t, c, dt, udt, nullable, default, generated in cur.fetchall():
        cols[t].append(dict(name=c, type=dt, udt=udt, nullable=nullable,
                            default=default, generated=generated))
    cur.execute(
        """
        select c.conrelid::regclass::text, c.confrelid::regclass::text,
               array(select attname from pg_attribute a join unnest(c.conkey) with ordinality k(n, i)
                     on a.attnum = k.n and a.attrelid = c.conrelid order by k.i),
               array(select attname from pg_attribute a join unnest(c.confkey) with ordinality k(n, i)
                     on a.attnum = k.n and a.attrelid = c.confrelid order by k.i)
        from pg_constraint c
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        """
    )
    fks = defaultdict(list)
    for t, ref, local, remote in cur.fetchall():
        fks[t].append(dict(ref=ref, local=list(local), remote=list(remote)))
    cur.execute(
        """
        select conrelid::regclass::text, conname, pg_get_constraintdef(oid)
        from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace
        """
    )
    checks = {name: (t, d) for t, name, d in cur.fetchall()}
    return tables, cols, fks, checks


def topo_order(tables, fks):
    deps = {t: {f["ref"] for f in fks[t] if f["ref"] != t and f["ref"] in tables} for t in tables}
    order, done = [], set()
    while len(done) < len(tables):
        ready = sorted(t for t in tables if t not in done and deps[t] <= done)
        if not ready:
            raise SystemExit(f"FK cycle among: {sorted(set(tables) - done)}")
        order += ready
        done |= set(ready)
    return order


def literal_options(check_def, column):
    """Allowed literals for `column` named in a CHECK definition, if any."""
    if not re.search(rf"\b{re.escape(column)}\b", check_def):
        return []
    found = re.findall(r"'([^']*)'::", check_def)
    return list(dict.fromkeys(found))


def base_value(col, tenant_ix, table):
    t, udt = col["type"], col["udt"]
    if t == "uuid":
        return str(uuid.uuid4())
    if t in ("integer", "smallint", "bigint"):
        return tenant_ix + 1
    if t in ("numeric", "double precision", "real"):
        return tenant_ix + 1
    if t == "boolean":
        return False
    if t == "date":
        return "2026-10-01"
    if t.startswith("timestamp"):
        return "2026-10-01T09:00:00Z"
    if t in ("json", "jsonb"):
        return psycopg.types.json.Jsonb({})
    if t == "ARRAY":
        return []
    if t == "USER-DEFINED":
        return None
    return f"{table}.{col['name']}.{'AB'[tenant_ix]}"


def seed(conn, tables, cols, fks, checks, tenants):
    rows = {t: {} for t in tables}  # table -> tenant -> row dict
    for tag, ten in tenants.items():
        rows["organizations"][tag] = {"id": ten["org"]}
        rows["users"][tag] = {"id": ten["uid"]}
    failures = {}
    for table in topo_order(tables, fks):
        if table in SKIP:
            continue
        for ix, tag in enumerate(tenants):
            ten = tenants[tag]
            values, overrides, tried = {}, {}, set()
            for attempt in range(25):
                values = {}
                fk_cols = set()
                for fk in fks[table]:
                    if fk["ref"] == table:
                        continue  # self-reference: leave null
                    if fk["ref"] == "auth.users":
                        src = {"id": ten["uid"]}
                    else:
                        src = rows.get(fk["ref"], {}).get(tag)
                    if not src:
                        continue
                    for lc, rc in zip(fk["local"], fk["remote"]):
                        if rc in src and src[rc] is not None:
                            values[lc] = src[rc]
                            fk_cols.add(lc)
                for col in cols[table]:
                    name = col["name"]
                    if col["generated"]:
                        continue
                    if name in overrides:
                        values[name] = overrides[name]
                    elif name in values:
                        continue
                    elif not col["nullable"] and col["default"] is None:
                        values[name] = base_value(col, ix, table)
                values = {k: v for k, v in values.items() if v is not None}
                q = sql.SQL("insert into {} ({}) values ({}) returning *, ctid::text as __ctid").format(
                    sql.Identifier(table),
                    sql.SQL(", ").join(map(sql.Identifier, values)),
                    sql.SQL(", ").join(sql.Placeholder() * len(values)),
                ) if values else sql.SQL("insert into {} default values returning *, ctid::text as __ctid").format(sql.Identifier(table))
                try:
                    with conn.transaction():
                        cur = conn.execute(q, list(values.values()))
                        names = [d.name for d in cur.description]
                        row = dict(zip(names, cur.fetchone()))
                    rows[table][tag] = row
                    break
                except psycopg.errors.CheckViolation as exc:
                    name = exc.diag.constraint_name
                    _, d = checks.get(name, (None, ""))
                    fixed = False
                    if "num_nonnulls" in d or "IS NULL) OR" in d:
                        named = [c["name"] for c in cols[table]
                                 if re.search(rf"\b{c['name']}\b", d) and values.get(c["name"]) is not None]
                        for extra in named[1:]:
                            overrides[extra] = None
                        if len(named) > 1:
                            continue
                    for col in cols[table]:
                        if col["type"] not in ("text", "character varying"):
                            continue
                        opts = literal_options(d, col["name"])
                        current = overrides.get(col["name"])
                        if opts and current not in opts:
                            overrides[col["name"]] = opts[0]
                            fixed = True
                            break
                        if opts and current in opts and len(opts) == 1:
                            continue  # already the only literal this check allows
                        if opts and opts.index(current) + 1 < len(opts) and col["name"] not in tried:
                            overrides[col["name"]] = opts[-1]
                            tried.add(col["name"])
                            fixed = True
                            break
                    if not fixed:
                        # Numeric range or comparison checks: try 1, then nulls.
                        for col in cols[table]:
                            if re.search(rf"\b{col['name']}\b", d) and col["name"] not in overrides and col["name"] not in fk_cols:
                                overrides[col["name"]] = None if col["nullable"] else (
                                    1 if col["type"] in ("integer", "smallint", "numeric") else values.get(col["name"]))
                                fixed = True
                                break
                    if not fixed:
                        failures[table] = f"check {name}: {d}"
                        break
                except psycopg.Error as exc:
                    failures[table] = f"{type(exc).__name__}: {str(exc).splitlines()[0]}"
                    break
            else:
                failures[table] = "gave up after 25 attempts"
    return rows, failures


def main(dsn):
    with psycopg.connect(dsn, autocommit=True) as conn:
        cur = conn.cursor()
        tables, cols, fks, checks = load_catalog(cur)
        tenants = {}
        for tag in ("A", "B"):
            uid, org = str(uuid.uuid4()), str(uuid.uuid4())
            email = f"manager-{tag.lower()}-{uid[:8]}@example.test"
            cur.execute("insert into organizations (id, name) values (%s, %s)", (org, f"Org {tag}"))
            cur.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
            cur.execute("update users set org_id = %s where id = %s", (org, uid))
            tenants[tag] = dict(uid=uid, org=org, email=email)

        rows, failures = seed(conn, tables, cols, fks, checks, tenants)
        # A clock, as ensure_entitlement() would have given, so a tombstone is due.
        for uid, ctid in conn.execute(
            "update subscriptions set status = 'trialing', trial_ends_at = now() + interval '1 year' "
            "returning user_id::text, ctid::text"
        ).fetchall():
            for tag, ten in tenants.items():
                if ten["uid"] == uid and tag in rows["subscriptions"]:
                    rows["subscriptions"][tag]["__ctid"] = ctid
        seeded = [t for t in tables if t not in SKIP and len(rows[t]) == 2]
        print(f"seeded {len(seeded)} of {len(tables) - len(SKIP)} tables for both accounts")
        if failures:
            for t, why in sorted(failures.items()):
                print(f"  could not seed {t}: {why}")

        # The export reads through the user's own JWT (RLS). As A, A's row must
        # be visible in every exported table and B's never.
        hidden, leaked = [], []
        with conn.transaction():
            conn.execute("set local role authenticated")
            conn.execute("select set_config('app.current_user_id', %s, true)", (tenants["A"]["uid"],))
            conn.execute("select set_config('app.current_user_email', %s, true)", (tenants["A"]["email"],))
            for t in tables:
                if t in NOT_EXPORTED:
                    continue
                visible = {r[0] for r in conn.execute(sql.SQL("select ctid::text from {}").format(sql.Identifier(t)))}
                ra, rb = rows.get(t, {}).get("A"), rows.get(t, {}).get("B")
                if ra and "__ctid" in ra and ra["__ctid"] not in visible:
                    hidden.append(t)
                if rb and "__ctid" in rb and rb["__ctid"] in visible:
                    leaked.append(t)
        print(f"export reads: A sees its own row in {len(tables) - len(NOT_EXPORTED) - len(hidden)} tables")

        before = {t: {r[0] for r in conn.execute(sql.SQL("select ctid::text from {}").format(sql.Identifier(t)))}
                  for t in tables}

        a = tenants["A"]
        with conn.transaction():
            conn.execute("set local role authenticated")
            conn.execute("select set_config('app.current_user_id', %s, true)", (a["uid"],))
            conn.execute("select set_config('app.current_user_email', %s, true)", (a["email"],))
            result = conn.execute("select delete_my_account()").fetchone()[0]
        print("delete_my_account() ->", result)

        problems = list(f"unseeded: {t}" for t in failures)
        problems += [f"{t}: export can't see A's own row" for t in hidden]
        problems += [f"{t}: export would include B's row" for t in leaked]
        for t in tables:
            after = {r[0] for r in conn.execute(sql.SQL("select ctid::text from {}").format(sql.Identifier(t)))}
            for tag, row in rows.get(t, {}).items():
                if "__ctid" not in row:
                    continue
                present = row["__ctid"] in after
                if tag == "A" and present:
                    problems.append(f"{t}: account A's row survived")
                if tag == "B" and not present:
                    problems.append(f"{t}: account B's row was deleted")
            lost = (before[t] - after) - {r.get("__ctid") for r in rows.get(t, {}).values()}
            if lost and t not in ("users", "organizations"):
                problems.append(f"{t}: {len(lost)} unseeded row(s) deleted")

        q = lambda s, *p: conn.execute(s, p).fetchone()[0]
        if q("select count(*) from auth.users where id = %s", a["uid"]):
            problems.append("A's auth.users row survived")
        if q("select count(*) from organizations where id = %s", a["org"]):
            problems.append("A's organization survived")
        if q("select count(*) from users where id = %s", a["uid"]):
            problems.append("A's users row survived")
        b = tenants["B"]
        if not q("select count(*) from auth.users where id = %s", b["uid"]):
            problems.append("B's login was deleted")
        if not q("select count(*) from organizations where id = %s", b["org"]):
            problems.append("B's organization was deleted")
        if not q("select count(*) from deleted_accounts where email_hash = account_email_hash(%s)", a["email"]):
            problems.append("no tombstone for A")

        if problems:
            print("FAIL")
            for p in problems:
                print("  -", p)
            sys.exit(1)
        print(f"PASS: every row of A's across {len(seeded)} tables is gone; B is untouched; tombstone written")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dbname=tsp_verify user=postgres")
