# The Same Page — Design Reference

Read this doc for any session involving UI, component decisions, visual design,
or UX patterns. Starts minimal — add decisions here as they get locked.

---

## Framework & tooling

- **CSS:** Tailwind CSS (configured in `frontend/tailwind.config.js`)
- **Components:** No component library yet — plain Tailwind. Add shadcn/ui
  if component complexity warrants it; confirm before pulling it in.
- **Icons:** Not yet decided.
- **Fonts:** Not yet decided.

---

## Design principles

1. **Manager-first clarity.** Every screen should answer a question the manager
   actually has, not display data for data's sake. If there's no clear question
   being answered, the screen is wrong.

2. **Calm, not busy.** The manager is already overwhelmed. The product should
   feel like it's reducing cognitive load, not adding to it. Prefer whitespace,
   clear hierarchy, one primary action per view.

3. **Mobile-aware but desktop-first.** Managers will use this at their desks
   before 1:1s. Design for desktop first. Responsive, but desktop is the
   primary viewport.

4. **Confidence, not just information.** The product's job is to make the
   manager feel prepared and confident. Copy, empty states, and AI output should
   all reinforce that feeling — not sound clinical or corporate.

---

## Page structure (current)

```
/ (marketing home)          frontend/app/(marketing)/page.tsx
/pricing                    frontend/app/(marketing)/pricing/page.tsx
/blog                       frontend/app/(marketing)/blog/page.tsx
/app/login                  frontend/app/app/login/page.tsx
/app/dashboard              frontend/app/app/dashboard/page.tsx
/app/reports/[id]           frontend/app/app/reports/[id]/page.tsx
/app/goals                  frontend/app/app/goals/page.tsx
/app/projects               frontend/app/app/projects/page.tsx
/app/org                    frontend/app/app/org/page.tsx
/app/capacity                frontend/app/app/capacity/page.tsx
/app/settings               frontend/app/app/settings/page.tsx
/app/assessments             frontend/app/app/assessments/page.tsx
/app/assessments/[reportId]  frontend/app/app/assessments/[reportId]/page.tsx
```

Marketing pages (`(marketing)/`) are public and need to be SSG-renderable for
SEO. Do not add client-side-only patterns to these pages.

---

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-14 | Tailwind for styling | Consistent with Prism Tree; fast for solo dev |
| 2026-07-14 | No component library yet | Avoid abstraction before we know what components we actually need |
| 2026-08-01 | Settings uses left-nav sections (Profile & Company / Roles & Levels / Expectations), not tabs or one long page | Three distinct setup jobs; nav keeps each screen answering one question |
| 2026-08-01 | Deferred settings sections get no placeholder/"coming soon" nav entries | Calm > roadmap-signaling; empty locked sections add noise for a solo manager |
| 2026-08-01 | DR detail "Expectations" section is hidden entirely when no role is assigned (no empty-state card); a role with zero configs gets a one-line Settings nudge | Calm degradation — an empty section answers no question; the nudge only appears once the manager has signaled intent by assigning a role |
| 2026-08-01 | In-call screen is two-column on desktop: prep sheet left, live "Call notes" pane right (sticky) | The screen the manager has open DURING the 1:1 must answer both "what should we cover" and "what's actually happening" without navigation |
| 2026-08-01 | AI wrap-up is always draft-then-review — extracted summary/commitments render on an editable review screen before anything saves | Commitments are accountability records; a hallucinated one costs trust in the entire product |
| 2026-08-02 | DR detail "1:1 History" renamed "1:1 Sessions" — now lists planned (prepped, not yet happened) alongside completed, with a status badge; a planned row is clickable straight into the resumed prep sheet | A prep sheet the manager can't get back to isn't useful; the list is now honest about what's upcoming vs. done, not just a log of the past |
| 2026-08-02 | Header CTA becomes "Resume prep sheet →" instead of "Start 1:1 prep →" whenever a planned session already exists for that report | The fix for "I lost my prep sheet" needs to be reachable from the primary action, not only from a list item further down the page |
| 2026-08-02 | Goals gets its own top-level page (`/app/goals`), not a Settings section | Settings is "configured once, not written to constantly" (see Settings decisions above); goals get created per period and have their status updated regularly — a different interaction pattern |
| 2026-08-02 | DR detail "Goals" section is always shown, with a one-line empty state + link when there are none — NOT hidden entirely like Expectations | Expectations is gated behind a Settings prerequisite (assign a role first), so hiding it until that's done is calm degradation. Goals has no such prerequisite — it's a first-class object like Commitments, so it follows Commitments' always-visible empty-state pattern instead. **Unconfirmed with Andrew** — the scoping question he answered actually said "hidden if empty"; this was a mid-build judgment call, flagged to him, may still get reverted |
| 2026-08-02 | Goals page ships full company/department/team/individual level tabs now, even though role-scoped views (manager/dept-head/individual) don't exist yet | Andrew's explicit call in the Session 10 scoping conversation, over the more conservative "individual only" default — company/department goals are usable today, just without a distinct dept-head/VP audience until role-scoped views ship |
| 2026-08-02 | Goal status is an inline `<select>` styled as a pill on each goal card, not a separate edit form | Status is the field that changes constantly (the reason Goals got its own page in the first place) — matches the existing inline-select pattern used for assigning a direct report's role in Settings |
| 2026-08-02 | Added a "Success metric" free-text field to the goal create form and card display, right below Description | Andrew wanted a SMART-framework "Measurable" anchor without over-structuring goals into fields that stay blank for anything that doesn't fit a rigid model — kept it as unstructured text, same as description, not a new metric-picker UI |
| 2026-08-02 | Goal cards get an "Edit" action next to Delete, which swaps the card in place for the same form used to create goals (pre-filled) rather than opening a modal or a separate page | Andrew caught this gap live in the deployed app — status and delete existed but there was no way to fix a typo or update a description. Reusing the create form in place keeps this to one component instead of building a second edit UI, and swapping in-place (not navigating away) matches how the rest of the page already behaves |
| 2026-08-02 | Org (team/department entities) gets its own top-level page (`/app/org`), not a Settings section | Same reasoning as Goals' placement (Session 10) — a distinct object, not a "configure once and forget" setting, even though it's edited less frequently than Goals |
| 2026-08-02 | Org-chart builder is a hybrid: a nested tree to add/edit/delete units and set parents, plus a separate read-only visual chart rendered from the same data | Andrew's explicit call over a true drag-and-drop canvas, which would require adding the app's first UI dependency (a diagramming library). The chart view uses styled-jsx (ships with Next.js) for a pure-CSS nested-list chart — no new dependency either way |
| 2026-08-02 | "Company" is not a stored `org_units` row — the chart root is the existing `organizations.name` (Settings → Profile & Company), with top-level departments (`parent_unit_id` null) branching directly off it | Avoids a row that would just duplicate what `organizations` already represents; proposed by Claude during scoping, confirmed by Andrew before building |
| 2026-08-02 | Settings' Roles & Levels form drops the free-text "Team (optional)" input, and `roleLabel()` stops appending `functional_team` to the role display | Session 11: team/department is now a structured `org_unit_id` on the direct report, not free text on the role template — keeping both would let them disagree. The "Who's in which role" list gets a second picker (org unit) next to the existing role picker |
| 2026-08-02 | Projects gets its own top-level page (`/app/projects`), not a tab on Goals | Session 13, same reasoning as Goals' own placement — projects get created and status-updated regularly |
| 2026-08-02 | Projects gets no `level`/`org_unit_id` of its own, unlike Goals | Per PRODUCT_VISION.md's "goals = what, projects = how" — a project's scope is derived from whatever it's linked to (its goal's level, or the report it's assigned to), not a duplicated parallel hierarchy. Revisit if a project ever needs independent scope (e.g. team-level with no goal attached) |
| 2026-08-02 | Projects list groups by assignee ("Your initiatives" first, then one group per direct report), same visual pattern as Goals' individual-level grouping | Keeps the list from turning into one flat wall once a manager has projects both of their own and delegated to reports |
| 2026-08-02 | DR detail "Projects" section is always shown, with a one-line empty state + link when there are none — same pattern as Goals | Session 13 also resolves Goals' Session 10 open question ("hidden if empty" vs. always-visible) the same direction, since both are first-class objects like Commitments with no Settings prerequisite |
| 2026-08-02 | Commitments → project linking (`source_type='project'`, already in schema.sql's check constraint) stays deferred | Same scope discipline as Goals shipping Session 10 without rollup calculation — activate the core object first, dogfood it, then decide if the cross-link earns its complexity |
| 2026-08-02 | Capacity gets its own top-level page (`/app/capacity`), not a Settings section | Session 14, same reasoning as Goals/Projects/Org — the resolved week-by-week numbers and time off log get checked/updated regularly; only the org-wide baseline defaults and work-unit setup are "configured once" and live in Settings |
| 2026-08-02 | Capacity v1 shows available hours only — no bar/meter comparing available vs. allocated | Andrew's explicit scoping call: supply only this pass, no demand/allocation tracking. A progress-bar visual implies something to fill it against; showing one before there's real allocation data would overstate what the page currently answers |
| 2026-08-02 | Capacity page's "By department" section shows aggregate numbers only (count + total hours per org unit), never a named individual outside the viewer's own direct reports | Andrew's explicit privacy call in Session 14 scoping — matches the existing privacy boundary (a manager's own reports stay private) while still answering the department-level bandwidth question |
| 2026-08-02 | Per-person capacity override (contracted hours, target utilization) and time off logging live on the DR detail page, not the Capacity page itself | Same "config that changes per-person lives next to the person" reasoning as Expectations — the Capacity page is the read/rollup surface, the DR detail page is where the underlying numbers get set |
| 2026-08-02 | Added a third capacity default, `off_days_per_year` (21 = 15 vacation + 6 sick), separate from target utilization — org default in Settings > Capacity, per-person override on the DR detail page, same pattern as the other two capacity fields | Andrew caught the gap live: target utilization only buffers within-a-day overhead, nothing accounted for whole days off unless a manager had already logged specific dates |
| 2026-08-02 | Capacity page labels each report's off-hours figure as "logged" or "assumed" rather than showing one unlabeled number | Two different sources feed the same figure (real dates vs. a prorated annual default) — showing which one won avoids the number reading as more precise than it is when nothing's been logged yet |
| 2026-08-03 | Role-scoped views ship as a third "Rollup" tab on the existing Org page, not a new top-level page | Session 15 — the rollup is inherently about org structure (a leader's subtree), so it belongs next to Build/Chart rather than adding a fifth top-level nav item; capacity hours stay on Capacity's own page rather than being duplicated |
| 2026-08-03 | Scoping mechanism is an explicit per-unit "leader" (`org_units.leader_user_id`, any org member can be assigned), not `users.role` tiers and not the manager-reporting chain | Andrew's explicit call — mirrors Capacity's Session 14 choice to walk the `org_units` tree rather than the manager chain, so there's one consistent source of truth for "who sees what" across every rollup |
| 2026-08-03 | Rollup views are aggregate-only everywhere, with no exception for any of the four surfaces (People/Goals/Projects/Capacity) | Andrew's explicit call, extending Capacity's Session 14 precedent uniformly rather than allowing named drill-down for some data types and not others |
| 2026-08-03 | Capacity's "By department" section now shows an empty state ("you don't lead any units yet") instead of the whole org's rollup by default | Closes the permission gap flagged in Session 14 — previously any authenticated org member could see the whole org's aggregate rollup with no assignment step; this is an intentional behavior change, not a bug, and needs Andrew to assign a leader before the section shows anything |
| 2026-08-04 | Assessments gets its own top-level page (`/app/assessments` + `/app/assessments/[reportId]`), not folded into DR detail | Session 16, same reasoning as Goals/Projects/Org/Capacity — scoring happens regularly, not once; DR detail gets a read-only summary + link, same "summary here, edit there" pattern as Goals/Projects/Capacity |
| 2026-08-04 | Scorecard inputs start empty rather than pre-filled with the direct report's latest recorded score; the latest score shows alongside each item as read-only context instead | Pre-filling would make an untouched "Save" silently re-log every unchanged score as a new timestamped row. Empty-by-default means only what the manager (or an AI draft) actually set this pass gets written — consistent with the draft-then-review rule elsewhere in the app |
| 2026-08-06 | Settings sub-section "currently selected X" state (e.g. Expectations' role/kind picker) lives on `SettingsPage`, not inside the section component | Settings unmounts the inactive section on every tab switch; state owned locally resets to defaults each time, which read as data loss once Andrew had stepped through many roles. Lifted to the parent, matching `roleLevels`/`reports`/`orgUnits` |
| 2026-08-06 | Team section's role/team `<select>`s get fixed widths (`w-48`/`w-44`) + truncate; report name/role_title get truncate too | An unconstrained select balloons to fit its longest option (e.g. "Enterprise Producer CSM · L2"), squeezing the sibling name column into unreadable wrapped slivers |
| 2026-08-04 | Skill/value scores render as a row of scale-point buttons (labeled with each point's configured qualitative/quantitative output when available) rather than a free-number input or dropdown | The scale definitions already carry meaning per point (Settings > Expectations, Session 6) — buttons surface that meaning directly instead of making the manager cross-reference a legend elsewhere |
| 2026-08-04 | AI draft prompt is explicitly told to leave an item unscored rather than force coverage of every configured metric/skill/value, and to return a null overall if there isn't enough evidence | Same restraint already proven in the 1:1 prep prompt's expectations block (Session 7) — a fabricated complete draft would erode trust in the assessment record faster than an honest partial one |

_(Add new decisions here as they get made — date, what was decided, why.)_
