# Handoff — marketing site navigation

**Task identity and branch**
Wire real HubSpot navigation menus into the marketing site theme. `main`.

**Objective**
Replace the hardcoded placeholder links in the header and footer partials with
HubSpot menus, so navigation is managed in HubSpot rather than in code and the
links actually go somewhere.

**Base commit**
The commit that closes this session. Compare against the branch before relying on
the remaining-work section below.

**Current state**
The theme is live in the HubSpot account `tsp-hubspot` (583675) as `tsp-theme`, and
a draft homepage exists built from it. Header and footer render correctly. Every
nav link is `href="#"` — the navigation is visually complete and functionally inert.

**Decisions already made**
- Header and footer are template partials included **outside** the `{% dnd_area %}`,
  so site chrome is identical on every page and not editable per-page. Keep this.
- Nav links are hardcoded only because theme `fields.json` rejects `text` field
  types. This was a fallback, not a design choice.
- HubSpot menus are the intended destination: build the menu in
  Settings → Content → Navigation, render with `{% menu %}`.

**Relevant files**
- `website/theme/templates/partials/header.html` — brandmark, `.nav-links`, sign-in, CTA
- `website/theme/templates/partials/footer.html` — brandmark, tagline, link row
- `website/theme/css/main.css` — `.nav-links a` and `.foot nav a` currently target
  bare anchors
- `website/scripts/verify-theme.py` — run before any upload
- `website/docs/build-process.md` — conventions and every HubSpot schema rule learned

**Verification completed**
`npm run verify` passes. Theme uploaded successfully and renders in the HubSpot page
editor. No backend, frontend, or schema code was touched this session, so no
typecheck, build, or migration verification was applicable.

**Remaining work**
1. Create the header and footer menus in HubSpot (Settings → Content → Navigation).
   Real pages do not exist yet for most destinations — decide whether to build stub
   pages first or point at anchors in the interim.
2. Swap the hardcoded anchors for `{% menu %}` in both partials.
3. **Most of the effort is CSS.** `{% menu %}` emits nested `ul`/`li` with HubSpot's
   own class names; the stylesheet targets direct `<a>` children. Update the
   selectors rather than fighting the markup, and keep the result inside the token
   system — no literal colours.
4. `npm run upload`, then confirm in the page editor.

**Next safe action**
Read `website/docs/build-process.md`, then inspect the two partials and the
`.nav-links` / `.foot nav` rules in `website/theme/css/main.css` before changing
anything.
