# Legal page set — argument

The case for the Legal pages, in order, before any pixels existed — though in
this case the pixels came first as three parallel prototypes, since all three
documents share one shape. Companion to `gtm/site/homepage.md`,
`gtm/site/about.md`, `gtm/site/contact.md` — same format, same voice rules,
though the voice on these three leans closer to Prism Tree's "readable, not
lawyerly" register than the rest of the site's confident-not-comforting one.
These are reference documents, not persuasion.

Source: Prism Tree's actual legal pages (`GTM/trust-docs/` in the Prism Tree
vault — `privacy-policy.md`, `terms-of-service.md`, `security-statement.md`,
plus the HubSpot-only `customer-agreements-hs.html` hub page), read in full
before writing anything here, per the brief. Andrew's decisions from this
session are folded in below, not re-litigated.

---

## The decisions this rests on

**Scope, decided this session: three standalone pages, no hub.** Prism
Tree's 4th page ("Customer Agreements") just card-links to the other three —
decorative, not structural. The Contact page's consent line already points
straight at `/legal/privacy`, and the site nav's "Legal" item (under Company,
already built by Andrew, page not yet picked) gets a single URL slot — so it
points straight at the Privacy Policy too, matching the same pattern rather
than building a fourth page just to give "Legal" somewhere generic to land.
Terms and Security are one click away — from the footer, and from a small
cross-link row at the bottom of each document (added here since skipping the
hub removes Prism Tree's only cross-linking surface between the three).

**Entity name: "The Same Page," no suffix.** Andrew confirmed the business
isn't filed as an LLC yet. Prism Tree's own docs never state a suffix either
— same pattern, brand name as the operating name, holds regardless of
incorporation status.

**Mailing address: reused from Prism Tree, Andrew's call.** 45 Portland Rd.
Ste 7 - 1008, Kennebunk, ME 04043-6660 — same address as Prism Tree's docs,
confirmed reusable.

**Contact: one address for everything, `andrewgodlew@gmail.com`.** Prism
Tree splits privacy@/hello@/security@ across its own domain; The Same Page
routes all three functions to the same inbox for now, matching how the
Contact page already routes support.

**Domain: thesamepage.xyz.** Two other domains turned up while researching
this (`app.thesamepage.io` in an old mockup, `thesamepage.app` assumed by the
notes-ingestion scoping doc) — neither is real. Andrew confirmed
`thesamepage.xyz`; the docs assume `app.thesamepage.xyz` for the product.

**AI and model training: a hard no.** Decided by Andrew 2026-10-22. All
three documents say we never use customer content to train AI models, ours
or anyone else's, and that content reaches an AI provider only at the moment
a feature runs, under commercial terms that bar the provider from training on
it. For a product holding notes about people's employees, that is the
simplest promise to keep and to read.

## The structural rewrite Prism Tree's docs don't need

Prism Tree's Career Brain is entirely self-entered — a user only ever stores
their own data. The Same Page is multi-tenant B2B: a manager's account holds
information *about* other people — their direct reports' goals, notes, and
assessment history. Section 2 of the privacy policy ("Data About Other
People on Your Team") is new, not adapted from anything in Prism Tree's
source. It does three things: names that this data exists, puts the
responsibility for having the right to collect it on the org (not on The
Same Page), and covers team members who have their own login the same way it
covers account holders. This is Andrew's framing to adjust, not a settled
legal position — flagged again below.

## What carried over as boilerplate (structure, not text)

The section skeleton in each document (What We Collect → How We Use It →
Third Parties → Storage/Security → Retention → Your Rights → Children's
Privacy → Changes → Contact), the standard SaaS clauses in the Terms
(eligibility, indemnification, limitation of liability, termination,
governing law), and the "AI output is not professional advice, review before
using it" disclaimer — genuinely more load-bearing here than in Prism Tree's
version, since your AI drafts (assessments, insights, wrap-ups) can feed
real personnel decisions in a way Prism Tree's career-coaching output
doesn't.

## What got rewritten, not just swapped

- **No Gmail OAuth, no BYOK API keys.** Confirmed against the app repo —
  neither exists. Prism Tree's entire "Gmail Integration" and "AI API Keys
  (BYOK)" privacy sections, and the matching encryption-at-rest paragraph in
  the security statement, are dropped rather than adapted. The security
  statement says plainly that there's no separate secrets-encryption layer
  to describe, because there's nothing to encrypt beyond the database itself.
- **Sub-processors are listed, with what each receives.** Supabase
  (database, storage, sign-in; AWS us-east-1, Northern Virginia, confirmed in
  the Supabase dashboard), Vercel, Railway, Anthropic, OpenAI (dictation
  transcription and the 5xx fallback in `ai_core.py`), PostHog, Sentry and
  HubSpot (wrap-up reminder email, marketing site, contact form). Stripe is
  promised "when billing is introduced" and gets added when it ships. When a
  new outside service starts receiving data, the Privacy table and the
  Security page change in the same release.
- **Governing law is Maine**, with disputes in Maine courts. Andrew confirmed
  2026-10-22.
- **Claims that track the product:** self-serve export and permanent
  deletion (Settings → Your account), no backups to restore from (Supabase
  Free), read-only after a free period, sign-in by emailed link (no
  passwords), usage events that never carry typed content. If any of these
  changes, the legal text is wrong until it is updated.

## Technical note for the build pass

Each document is one long-form block of content, which argues for a single
new module — `legal-body.module`, already named in `build-process.md`'s
planned module list — with a `richtext` field (`copy`, not `body`, per the
reserved-name rule) carrying the whole thing: headings, paragraphs, lists,
and the one table, all editable in HubSpot's page editor exactly the way
`founder.module`'s quote field already works. `effective_date` /
`updated_date` as small `text` fields feed the meta line under the frame.
No repeatable groups needed — a policy document doesn't decompose into
repeated items the way the homepage's stats or recognition lines do.

One dedicated template, `legal.html`, seeded with `frame` + `legal-body` and
reused for all three pages — same "repeated + simple → dedicated template"
call as About and Contact. No `close-cta` on these pages; like Contact, a
reference document shouldn't compete with itself for the reader's attention,
and the footer/nav CTA is unbroken everywhere else on the site.

## SEO

- **Privacy** — Title: `Privacy Policy — The Same Page`. Meta: "What The
  Same Page collects, how we use it, and your rights — including how it
  handles data about the people you manage." (149 characters)
- **Terms** — Title: `Terms of Service — The Same Page`. Meta: "The rules of
  the road for using The Same Page — accounts, acceptable use, AI-generated
  content, and what happens if things go wrong." (143 characters)
- **Security** — Title: `Security Statement — The Same Page`. Meta: "How The
  Same Page protects your organization's data at rest and in transit —
  encryption, row-level security, and responsible disclosure." (145
  characters)

## Where the live text lives

Live at `/legal/privacy`, `/legal/terms` and `/legal/security` on
thesamepage.xyz, each a `legal.html` page whose `legal-body` module holds the
whole document. The source for each body is
`website/prototype/legal-body-{privacy,terms,security}.html`: edit there,
then replace the module's text through the rich-text field's Advanced →
Source code view (pasting rendered text strips the headings), and set
"Last updated". The footer carries Privacy / Terms / Security links from
`partials/footer.html`.

## Open questions

- None blocking. Worth a lawyer's read once there are paying customers,
  starting with Section 2 of the Privacy Policy (data about the people you
  manage), which is new language with no Prism Tree precedent.
