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
```

Marketing pages (`(marketing)/`) are public and need to be SSG-renderable for
SEO. Do not add client-side-only patterns to these pages.

---

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-14 | Tailwind for styling | Consistent with Prism Tree; fast for solo dev |
| 2026-07-14 | No component library yet | Avoid abstraction before we know what components we actually need |

_(Add new decisions here as they get made — date, what was decided, why.)_
