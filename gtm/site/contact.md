# Contact page argument

The case the Contact page makes, in order, before any pixels exist. Companion
to `gtm/site/homepage.md` — same format, same voice rules.

Sources: `gtm/site/homepage.md`, `website/docs/build-process.md` (the open item on
support routing), the nav build note in `marketing_site_hubspot.md`.

---

## The decisions this rests on

**Scope, decided 2026-08-25: one page, one form, both angles.** The nav
already renamed this destination from "Contact Us" to "Support." Rather than
build two thin pages, this is a single page that answers both — a product
question, something broken, general or partnership inquiry — through one
inbox. Splitting sales-contact from support-contact only makes sense once
there's enough volume to route differently, and with a founding cohort of 20
that isn't yet.

**One form field set, one channel.** Name, email, message. No listed email
address, no booking link — just the form. Fewer channels means fewer places
an early message can get lost, and it keeps the page to one clear action
instead of asking the visitor to choose between three.

**No secondary CTA.** Unlike every other page on the site, this one doesn't
end on "Start free." The visitor is already mid-action (filling out a form);
a second competing ask right below it would split attention between two
things at once, right when the page should be narrowing to one. The nav and
footer still carry that CTA everywhere else.

## Section 1 — Frame

**Job:** say plainly that this is one inbox for anything, and set the reply
expectation up front so the visitor isn't wondering whether the form goes
into a queue.

| Slot | Line |
|---|---|
| Eyebrow | Contact |
| H1 | Talk to us. |
| Sub-headline | Question about the product, something broken, or feedback on where we should go next — tell us. One inbox, no ticket queue, no bot in between. |

"No bot in between" is doing real work here — it's the honest, small-company
position (see the homepage's "being early is the honest position" rule)
applied to support, not just to the founding offer.

## Section 2 — Form

**Job:** the entire page. Three fields, in the order best-practice sources
agree on — easiest first:

| Field | Type | Required |
|---|---|---|
| Name | text | yes |
| Email | email | yes |
| Message | textarea | yes |

Submit button label: **Send message** — not "Submit." Action-specific button
copy is one of the few form-conversion findings that shows up in every source
checked (HubSpot's own form-design guidance included): a visitor should be
able to read the button alone and know what happens next.

Below the button, in small type: *We read every message and reply within one
business day.* This replaces a live-chat widget or an "average response time"
badge — it's a plain promise instead of a mechanism, which fits a one-person
team honestly and doesn't over-promise something automated.

Consent line, small type, under the response-time note: *By sending this, you
agree to our [Privacy Policy].* — standard practice for any form that collects
an email address, and HubSpot's own forms product expects a privacy-policy
link to be present. Links to `/legal/privacy`, which doesn't exist yet (see
Open questions).

**Technical note for the build pass** — not a design decision, just what the
module needs when this gets cut into HubSpot: a module `fields.json` with a
`type: "form"` field wired to a real HubSpot form (created in Marketing →
Forms, referenced by `form_id`), rendered with the `{% form %}` HubL tag
inside `module.html`. That form doesn't exist yet either — it gets created
directly in HubSpot's form tool, not written as code, the same way the nav
menu was.

## No section 3

Deliberately. See "No secondary CTA" above.

---

## SEO

- **Title tag:** `Contact — The Same Page`
- **Meta description:** "Have a question, feedback, or something broken? Get
  in touch with The Same Page — real replies, no ticket queue." (117
  characters — could carry more if useful later)
- **H1** ("Talk to us.") again deliberately distinct from the title tag.

## Open questions

- **Nav label mismatch.** The site menu currently reads "Support" for this
  destination (renamed from "Contact Us" per the 2026-08-25 nav-build note).
  This page is written to serve both angles, so either label describes it
  reasonably — but "Support" reads narrower than what the page actually does.
  Worth deciding once, rather than letting the mismatch sit: keep "Support,"
  revert to "Contact," or use something that covers both ("Get in touch").
  Andrew's call — flagging rather than changing the menu.
- **The HubSpot form itself** doesn't exist yet — needs to be created in the
  portal before this can go from prototype to a working module. Where it
  routes (a shared inbox, a specific email, CRM-only) is also undecided.
- **Privacy policy page** doesn't exist yet (`website/docs/build-process.md` lists
  the legal page set as not started). The consent line links to a page that
  isn't live — needs to land before this page ships for real, not just in
  prototype.
