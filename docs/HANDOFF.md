# Handoff — 1:1s index UX redesign

## Task identity and branch

- Task: Review and redesign the `/app/1-1s` index experience.
- Checkpoint: `main` at `d3877f55e8fb61990237e25d65ad2302ad18a3b2`; this worktree is detached at the same commit.

## Objective

Act as a senior product/UX designer. Review the live 1:1s page and its implementation, separate usability findings from marketing and screenshot considerations, then create three genuinely distinct high-fidelity mockup directions. Preserve the page's primary job as a useful triage index and direct route to each person's 1:1 workspace. Stop after presenting the review and mockups so Andrew can select or combine a direction; do not implement a production direction yet.

## Created or updated

2026-08-25

## Base commit

`d3877f55e8fb61990237e25d65ad2302ad18a3b2` — Build the Mission Control management runway

## Current state

- `/app/1-1s` is functionally sound but visually reads as a simple list.
- Its current sections are Due now, Upcoming 1:1s, and Recently wrapped, with direct links into prep or a person's page.
- It is the canonical front door for the recurring 1:1 loop and uses server-derived workflow state; do not add competing frontend scheduling or staleness logic.
- The redesigned Mission Control management runway is live. It joins Team, Relationship Desk, assessment, and individual 1:1 surfaces as the current quality bar.
- No 1:1s index design or implementation work has started.

## Decisions already made

- Keep the page a judgment-oriented triage/index surface, not a generic calendar, employee leaderboard, or vanity dashboard.
- Preserve quick person-finding and direct navigation to prep and relationship workspaces.
- Production usefulness is primary; screenshotability is a separate design consideration.
- Use the existing dark theme, locked brand tokens, and seeded Forkcast Labs content. Do not hardcode colors.
- Produce three directions with meaningfully different information hierarchy and interaction models, verify them visually, and explain each direction's thesis, strengths, risks, and best screenshot moment.
- Ask Andrew only when browser sign-in is actually required. Never place demo credentials in files or logs.
- Do not implement a direction until Andrew selects or combines one.

## Relevant files and surfaces

- `CLAUDE.md`
- `docs/DESIGN.md`
- `docs/systems/brand.md`
- `docs/systems/one-on-ones.md`
- `docs/systems/mission-control.md`
- `frontend/app/app/1-1s/page.tsx`
- `frontend/app/app/reports/[id]/page.tsx`
- `frontend/components/mission-control/ActionBrief.tsx`
- Live app: `https://thesamepage-blush.vercel.app/app/1-1s`

## Verification completed

- The preceding Mission Control redesign passed the production build and deployed successfully to Vercel and Railway.
- The repository is clean at the base commit; no 1:1s index files have been changed.

## Remaining work or blocker

- Review the live `/app/1-1s` experience and current implementation.
- Identify hierarchy, storytelling, interaction, visual-design, and screenshotability issues, keeping usability findings separate.
- Create and visually verify three interactive, high-fidelity mockup directions using realistic Forkcast Labs content.
- Present the directions for Andrew's selection without changing the production page.
- There is no known blocker. Request sign-in from Andrew only if the live browser session requires it.

## Next safe action

Read `CLAUDE.md`, this handoff, and the routed design, brand, and 1:1 system guidance. Then inspect the live page and implementation before creating mockups. Keep the work review-and-prototype only until Andrew chooses a direction.
