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
/app/settings               frontend/app/app/settings/page.tsx
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

_(Add new decisions here as they get made — date, what was decided, why.)_
