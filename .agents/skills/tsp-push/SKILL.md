---
name: tsp-push
description: Close out work in The Same Page by verifying the checkpoint, reviewing the diff, updating current truth and durable decisions when needed, preserving unfinished work in an overlap-safe handoff, and committing and pushing the scoped changes. Use when Andrew asks to push, commit, close out, or run TSP Push in this project.
---

# TSP Push

Close the current task without turning project history into permanent context.

## Sources of truth

- The current conversation explains the task's intent and the reasoning behind decisions.
- The working tree and diff prove what changed.
- Canonical docs describe how the project works now.
- Decision records preserve the rationale for the small set of choices that are
  cross-cutting, risky, costly to reverse, or likely to be revisited.
- Git commits record completed history and the durable reasoning for ordinary work.
- `docs/HANDOFF.md` exists only when work is genuinely unfinished.

Do not update `docs/SESSION_HISTORY.md`. It is a frozen legacy reference, consulted only for historical questions that Git or a current decision record cannot answer.

## Closeout workflow

### 1. Establish scope, completion, and active-task state

Determine what was changed or decided and whether the requested task is complete.

Treat work as **continuing** only when another session must resume unfinished implementation, verification, migration, investigation, or a still-open decision. A possible next feature, later optimization, dogfooding idea, or roadmap opportunity does not make completed work unfinished.

A handoff does not make a broken or unsafe checkpoint acceptable to push. Because this repository deploys from `main`, continuing work must still leave the committed tree in a verified, deployable state. If it does not, stop and explain the blocker instead of pushing.

If `docs/HANDOFF.md` already exists, inspect it before replacing or removing it.
Preserve it when it belongs to unrelated work. If its relevant files overlap the
current task, reconcile the two scopes before closeout rather than silently
discarding either state.

### 2. Inspect Git before editing docs

Review the status, diff, and recent commit style. If the tree is clean, report that there is nothing to push and stop. If unrelated or unexplained changes exist, preserve them and exclude them from the closeout; ask Andrew only when they overlap the requested work and cannot be separated safely.

### 3. Verify the checkpoint

Run the verification appropriate to the actual diff before calling the checkpoint
deployable. Use the project's documented commands and favor the narrowest check
that proves the changed boundary, plus broader build or schema checks when the
change can affect them.

- Backend or API changes: run relevant tests and confirm the application imports.
- Frontend changes: run typechecking and the production build when the environment permits.
- Schema or migration changes: verify both the migration path and the final
  `schema.sql` from a fresh local database, including functional RLS checks when
  a policy or SECURITY DEFINER function changed.
- AI prompt or agent-loop changes: run the relevant eval when credentials are available.

Do not describe a check as passed when it was not run. If a required check cannot
run, state the limitation and decide whether the checkpoint is safe to commit but
not push, or whether closeout must stop. Never bypass a required remote status or
deployment check.

### 4. Update current truth and durable decisions selectively

Default to no documentation edit unless the change makes a current statement false, incomplete, or materially misleading.

| Document | Update when |
|---|---|
| `docs/systems/<area>.md` | The behavior or boundary of that subsystem changed. |
| `docs/ENGINEERING.md` | An app-wide architecture, security, data, infrastructure, or verification convention changed. |
| `docs/DESIGN.md` | A reusable UI convention or still-load-bearing design decision changed. |
| `CLAUDE.md` | Project routing, hard rules, top-level structure, or closeout conventions changed. |
| `PRODUCT_VISION.md` | Product scope, priority, or roadmap intent changed. |
| `gtm/business-model.md` | Pricing, tiers, distribution, or content strategy changed. |
| `gtm/positioning.md` | What we are, to whom, or against what alternative changed. |
| `gtm/personas/<persona>.md` | Who we sell to, what they believe, or their language changed. |
| `gtm/brand/<file>.md` | A voice, register, or messaging rule changed. |
| `gtm/site/<page>.md` | The argument behind a marketing page changed. |
| `docs/decisions/<decision>.md` | A qualifying durable decision was proposed, accepted, superseded, rejected, or implemented. |

Canonical docs describe the present rather than narrating the change. Rewrite stale text in place. Move materially superseded reference content to the appropriate `docs/archive/` file when retaining it has historical value. Do not add session numbers, dated follow-up headings, or implementation details already obvious from the code and diff.

Create or update a decision record only when the choice is materially
cross-subsystem, changes a security/privacy/data boundary or customer promise,
has credible competing alternatives, is costly to reverse, supersedes an earlier
decision, or is likely to be relitigated without its rationale. Ordinary local
implementation choices belong in the commit body, not a new document.

A decision record stays short and includes status, context, decision, meaningful
rejected alternatives, consequences or accepted limitations, implementation
commit when known, supersession links, and evidence that should reopen it. When
implementation ships, update the record's lifecycle status; do not leave an
accepted proposal claiming that no code exists.

### 5. Maintain the conditional handoff

If the work is continuing, create or replace `docs/HANDOFF.md` with a compact, factual resume brief:

- **Task identity and branch**
- **Objective**
- **Created or updated**
- **Base commit**
- **Current state**
- **Decisions already made**
- **Relevant files**
- **Verification completed**
- **Remaining work or blocker**
- **Next safe action**

Include only information another capable agent could not recover cheaply from the current code and diff. Never copy the conversation or create a general project summary.

The base commit and relevant files are freshness checks, not claims that the
handoff is automatically current forever. A resuming agent must compare them to
the branch and intervening changes before relying on the remaining-work section.

If the task is complete, remove `docs/HANDOFF.md` only when it belongs to this completed work. Never remove a handoff for unrelated work.

### 6. Build a scoped commit

Stage only the files belonging to this task. Do not use `git add .` or `git add -A` when unrelated local changes could be captured.

Use an imperative subject consistent with recent history. A concise body is
required for nontrivial features, schema or migration work, security/privacy/data
boundaries, customer-visible behavior changes, reversals, rollout or rollback
constraints, accepted limitations, and other reasoning the diff cannot preserve.
It should cover why, durable boundaries or limitations, and material verification.
Link a decision record instead of duplicating its rationale. Git already records
the exact file changes; do not recreate a session summary.

When the environment has authorized Git write and network access, use the
repository's required-check workflow. Push directly only when that is the
configured safe path and every relevant verification gate has passed. Never
bypass branch protection, required status checks, or deployment checks. If direct
Git operations are unavailable but the repository is reachable through Claude's
remote-device workflow, read [references/claude-remote-git.md](references/claude-remote-git.md) and provide the paste-ready fallback.

### 7. Report the outcome

Tell Andrew what was committed, what verification ran or could not run, which
canonical docs, decision records, or handoff changed, and whether the push or
required-check workflow succeeded. Keep the report brief and do not recreate a
session summary.
