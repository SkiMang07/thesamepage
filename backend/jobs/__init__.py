"""Background work that runs on the worker service, not on a request.

`python -m jobs.worker` is the worker's start command (a second Railway
service built from this same backend/ directory). Each module here is one kind
of scheduled AI work; `ai_jobs` is their shared ledger. See
docs/ENGINEERING.md → Background worker.
"""
