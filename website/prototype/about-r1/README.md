# About page, round 1: theme-ready, not yet in the theme

Drafted 2026-09-28 alongside `../about-r1.html` (the rendered prototype). Not cut into
`website/theme/` yet: Andrew is taking About into its own session.

- `templates/about.html` replaces `website/theme/templates/about.html` (no About page is
  live, so nothing depends on the old template). It uses the site header and footer.
- `modules/about-page.module/` is new: the whole page in one module. The letter's
  default is the full five paragraphs that used to be "A bit about me" on the contact page.
- `about-r1.css` appends to the end of `website/theme/css/main.css`. It reuses the contact
  page's grid and pieces (`.ct-split`, `.ct-side`, `.ct-reach`, `.ct-tile`, `.ct-portrait`,
  `.ct-tagline`), so it must come after the "CONTACT PAGE, ROUND 5" block.

Copy approved by Andrew on 2026-09-28: "A bit about me" as the H1, "Say hello." above the
links, "First 20 managers, first year free" on the early-access line.

To go live: copy the three pieces in, run `npm run verify`, `npm run upload`, create the
page from the "Page — About" template at `/about`, and add About to the site nav menu.
