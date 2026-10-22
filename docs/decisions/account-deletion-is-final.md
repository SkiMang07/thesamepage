# Account deletion is final, complete, and tombstoned

**Status:** Accepted 2026-10-22 (Andrew). PRELAUNCH_BACKLOG §7 E.

## Context

A manager must be able to take their record and leave. The project is on
Supabase Free, which has no backups, so anything deleted is gone for good.
Copies of a manager also sit outside the database: a HubSpot contact (the
first-1:1 wrap-up reminder) and a PostHog person with their events.

## Decision

- **Delete everything, at once.** `delete_my_account()` removes every row the
  account owns, the org and the login in one transaction. No soft delete, no
  grace period. The confirmation says plainly that nothing can be recovered.
- **Outside copies are deleted by API, first.** The HubSpot contact (GDPR
  delete) and the PostHog person with events go before anything in our
  database. If either fails, nothing is deleted and the person can try again.
- **The export is JSON only.** Every table, rows as stored; uploaded files are
  not bundled, their extracted text is.
- **A hashed-email tombstone.** `deleted_accounts` keeps sha256(lowercased
  email), the clock the account had, and whether it was comped. Signing up
  again with that email gets the old clock back and no founding place.

## Rejected alternatives

- **Service-role delete through the Supabase admin API.** Would put the
  service-role key on a request path (ENGINEERING.md forbids it) and could not
  be atomic with the row deletes.
- **Leave HubSpot and PostHog to a manual monthly sweep.** Rejected by Andrew:
  "delete" should mean delete.
- **Zip the uploaded originals into the export.** More to build and to hold in
  memory for little gain before launch; the text is what the product used.
- **No tombstone.** Delete and re-sign-up would hand out a new founding place
  or reset a 14-day trial.

## Consequences

- A new table needs a line in `delete_my_account()` (or a cascade from one
  that has one) and a place in the export lists. Two guards catch a miss:
  `backend/tests/test_account.py` in CI, and
  `database/checks/account_deletion_check.py` against a local Postgres.
- An unsalted sha256 of an email can be reversed by guessing the email. It
  holds no data and is never readable through the API; that trade was taken
  over storing the plain address.
- GDPR-deleting a HubSpot contact also removes that email from the other
  lists in the shared portal (Prism Tree, By 2 Pedals).
