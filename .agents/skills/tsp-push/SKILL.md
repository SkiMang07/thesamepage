---
name: tsp-push
description: Close out work in The Same Page by reviewing the diff, updating only current-state documentation that changed, preserving genuinely unfinished work in a compact handoff, and committing and pushing the scoped changes. Use when Andrew asks to push, commit, close out, or run TSP Push in this project.
---

# TSP Push

Close the current task without turning project history into permanent context.

## Sources of truth

- The current conversation explains the task's intent and the reasoning behind decisions.
- The working tree and diff prove what changed.
- Canonical docs describe how the project works now.
- Git commits record completed history.
- `docs/HANDOFF.md` exists only when work is genuinely unfinished.

Do not update `docs/SESSION_HISTORY.md`. It is a frozen legacy reference, consulted only for historical questions that Git or a current decision record cannot answer.

## Closeout workflow

### 1. Establish scope and completion state

Determine what was changed or decided and whether the requested task is complete.

Treat work as **continuing** only when another session must resume unfinished implementation, verification, migration, investigation, or a still-open decision. A possible next feature, later optimization, dogfooding idea, or roadmap opportunity does not make completed work unfinished.

A handoff does not make a broken or unsafe checkpoint acceptable to push. Because this repository deploys from `main`, continuing work must still leave the committed tree in a verified, deployable state. If it does not, stop and explain the blocker instead of pushing.

### 2. Inspect Git before editing docs

Review the status, diff, and recent commit style. If the tree is clean, report that there is nothing to push and stop. If unrelated or unexplained changes exist, preserve them and exclude them from the closeout; ask Andrew only when they overlap the requested work and cannot be separated safely.

### 3. Update documentation selectively

Default to no documentation edit unless the change makes a current statement false, incomplete, or materially misleading.

| Document | Update when |
|---|---|
| `docs/systems/<area>.md` | The behavior or boundary of that subsystem changed. |
| `docs/ENGINEERING.md` | An app-wide architecture, security, data, infrastructure, or verification convention changed. |
| `docs/DESIGN.md` | A reusable UI convention or still-load-bearing design decision changed. |
| `CLAUDE.md` | Project routing, hard rules, top-level structure, or closeout conventions changed. |
| `PRODUCT_VISION.md` | Product scope, priority, or roadmap intent changed. |
| `docs/GTM.md` | Pricing, ICP, positioning, distribution, or go-to-market changed. |

Canonical docs describe the present rather than narrating the change. Rewrite stale text in place. Move materially superseded reference content to the appropriate `docs/archive/` file when retaining it has historical value. Do not add session numbers, dated follow-up headings, or implementation details already obvious from the code and diff.

### 4. Maintain the conditional handoff

If the work is continuing, create or replace `docs/HANDOFF.md` with a compact, factual resume brief:

- **Objective**
- **Current state**
- **Decisions already made**
- **Relevant files**
- **Verification completed**
- **Remaining work or blocker**
- **Next safe action**

Include only information another capable agent could not recover cheaply from the current code and diff. Never copy the conversation or create a general project summary.

If the task is complete, remove `docs/HANDOFF.md` only when it belongs to this completed work. Never remove a handoff for unrelated work.

### 5. Build a scoped commit

Stage only the files belonging to this task. Do not use `git add .` or `git add -A` when unrelated local changes could be captured.

Use an imperative subject consistent with recent history. Add a concise body when the reasoning is not obvious from the diff. The body should prioritize why, durable boundaries, and material verification; Git already records the exact file changes.

When the environment has authorized Git write and network access, commit and push directly. If direct Git operations are unavailable but the repository is reachable through Claude's remote-device workflow, read [references/claude-remote-git.md](references/claude-remote-git.md) and provide the paste-ready fallback.

### 6. Report the outcome

Tell Andrew what was committed, which canonical docs or handoff changed, and whether the push succeeded. Keep the report brief and do not recreate a session summary.
