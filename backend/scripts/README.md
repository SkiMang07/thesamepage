# Forkcast Labs demo seed

`seed_forkcast_demo.py` creates a realistic, entirely fictional SaaS company for
product screenshots, demos, and training documentation.

## What it creates

- Forkcast Labs, a restaurant demand-forecasting SaaS company.
- Five fictional manager Auth identities and 23 employees across Customer
  Success, Support, Sales, Marketing, Product, and Engineering.
- A detailed seven-person Customer Success team managed by Jamie Vega.
- Role ladders and expectations, rolling assessments, metric evidence,
  development plans, capacity, 1:1 history and prep, team meetings,
  commitments, goals, projects, and check-ins.
- A connected screenshot story centered on Mina Okafor and the at-risk Copper
  Kettle rollout.

All people, companies, customers, emails, and performance records are
fictional. Non-login addresses use reserved example domains.

## Safe dry run

Dry run is the default. It requires no credentials and performs no network
calls or writes:

```bash
python backend/scripts/seed_forkcast_demo.py
```

Use `--anchor-date YYYY-MM-DD` to verify a particular demo week. Object UUIDs
remain stable while relative dates move with the anchor.

## Applying the seed

Live application is intentionally explicit and requires runtime-only secrets:

```bash
SUPABASE_URL="..." \
SUPABASE_SERVICE_ROLE_KEY="..." \
TSP_DEMO_MANAGER_EMAIL="..." \
TSP_DEMO_MANAGER_PASSWORD="..." \
python backend/scripts/seed_forkcast_demo.py --apply
```

Never place these values in this file, a committed `.env`, or a shell script.
The primary demo password must be at least eight characters and should be
changed before the account is used for anything beyond controlled demos.

The runner:

1. Refuses any Supabase project except The Same Page production project.
2. Verifies every seeded table and column against the live schema, including
   the removal of the legacy `team_meetings.meeting_date` field.
3. Performs read-only conflict checks before changing any Auth identity.
4. Creates or reuses five Auth users tagged `tsp_demo_seed=true`.
5. Refuses an untagged, populated, or non-Forkcast primary account.
6. Resets only the deterministic Forkcast organisation and its tagged managers.
7. Inserts the full dataset in dependency order.
8. Re-reads every seeded ID and fails if live counts do not match.

`--adopt-existing-empty-user` is available only for a primary Auth user that was
created separately and has no organisation or manager data. It never permits
adopting a populated account.

## Resetting

Run the same `--apply` command again. It clears interaction state such as Mission
Control dispositions before rebuilding Forkcast relative to the new anchor
date. Auth identities remain stable, so the demo login does not change.

## Tests

```bash
python -m pytest backend/tests/test_forkcast_demo_seed.py -q
```

The tests cover deterministic identity, fictional email domains, performance
distribution, the cross-surface Mina narrative, Mission Control eligibility,
and date shifting.
