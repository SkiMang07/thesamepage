# First run — design exploration

**Date:** 2026-09-29 · **Status:** app-styled version awaiting Andrew's review · **Nothing built in the app**

## Round 2 (current): onboarding in the product's own look

Andrew asked (2026-09-29) whether onboarding should match the website or the product. The answer is the product. Onboarding is the first session in the app, and its job is to make the fourth visit feel familiar. A light, paper-styled flow that ends by dropping into the dark app gives the manager a second first impression. The website hands over three things: the promise (see where your team stands and what's next), the object (a person's page), and Andrew's welcome. It doesn't hand over its styling. The login page is the seam and can stay site-styled.

`prototype.html` is now built in the app's dark theme, using the vocabulary of the approved Relationship Desk prototype: Georgia headings, the teal primary button, the Team roster rows, the person identity header, and the "Next conversation" card with its topic rows and sources line.

- **Step 1.** Who's your next 1:1 with? Andrew's welcome sits beside the question. The Team panel appears as the name is typed.
- **Step 2.** The roster. Each line becomes a row in the Team panel.
- **Step 3.** Notes, optional. The person's page shows with its "Next conversation" card and "No earlier 1:1s with Priya are recorded."
- **Step 4.** The agenda writes itself into that card one topic at a time, labelled "Drafted by AI · you review before it saves" with "Drew on: …". Every line is editable, and Save stays disabled until writing finishes.
- **Step 5.** A save receipt, then "Go to Mission Control". The nav rail slides in and the same content becomes Mission Control, with the day-one morning line and Today's moves. No jump between two different looks.

Validation: clicked through at 1440 and 390 in headless Chromium with no page errors (renders `renders/app-*.png`). Not wired: the "Other date" picker, and real prep calls (the agenda is canned).

`prototype-v1-site-style.html` is round 1 (below), kept for comparison.

---

## Round 1 (superseded): The Page styling

Andrew's brief (2026-09-28): the onboarding should be memorable, succinct, clear and engaging. The flow he chose on 2026-09-24 stays: Direction A (straight to the first 1:1) plus B's one-line roster as the second screen (`docs/archive/scoping/ONBOARDING_SCOPING.md`). This package covers only how that flow looks and feels.

## What changed from the scoping doc

- **The Page visual system** carries over from the site into the app: Newsreader questions, paper sheets with the teal margin rule, mono dates. So the first screen after "Start free" looks like the page the manager just read.
- **The answers become pages as you type them.** The right half is a desk. Typing a name puts that person's page on it; each roster line adds another. The manager watches their team come together instead of filling in a form.
- **The founding place is a welcome from Andrew**, as a short signed note on the desk (marked DRAFT: the words are placeholders for Andrew's own). The mono line above the first question keeps the plain fact: "Founding manager 7 of 20 · Free until {sign-up + 1 year}".
- **The first agenda writes itself onto the person's page**, one item at a time, labelled "Drafted by AI · you review before it saves". Every line is editable in place. Save is disabled until it has finished writing.
- **The finish is the handoff into the dark app**: Mission Control opens with the people already in it and the B3 morning line written for day one.
- **Keyboard:** Enter moves step 1 on; ⌘↵ moves the text-box steps on. Three questions, no nav, no Scribe.

## The two directions

**A · A page per person.** Each person gets their own sheet. Priya's is on top, and the roster stacks behind it with name tabs. Andrew's note gets tucked under the stack once a name is typed. It's the most literal "a doc per person, done well" and the strongest first impression. The cost is that the stack is decoration on a phone (hidden below 900px).

**B · One contents page.** A single "Your team" sheet with a contents line per person (dotted leaders, as in the homepage hero's team list). Andrew's note is paper-clipped to the corner. Priya's line opens in place to hold the notes and the agenda. It's calmer, works the same on a phone, and previews the bird's-eye team view that is the product's bigger promise. It's less of a moment.

**Recommendation: A on desktop, B's layout on mobile.** A is the memorable one, and B is what a phone can show anyway. If Andrew wants one system everywhere, pick B.

## Copy

It follows the voice rules: literal labels, no encouragement, and the product never talks about itself. Sharing copy is present tense only. The draft agenda mirrors the first-1:1 prompt branch in the scoping doc §4.5 (how they like to work, what's on their plate, what they want from the role, how you'll run these, the closing question), plus a "From your notes" item when the manager wrote something.

## Open for Andrew

1. A or B (or A desktop / B mobile).
2. The welcome note: his own words, 2–3 sentences. The draft is a placeholder.
3. The founding line wording. The prototype says "Founding manager 7 of 20 · Free until 28 Sept 2027".
4. The four questions still open in `ONBOARDING_SCOPING.md` §8. The prototype assumes: no skip on step 1, Assessments/Capacity/Org hidden on day one, and "Other date" opens a picker (not wired in the prototype).

## Validation

Clicked through both directions at 1440 and 390 in headless Chromium: name → date → roster (dedupes the step-1 name, strips list markers, counts live) → notes → agenda writes → save → Mission Control. No console errors apart from the Google Fonts request being blocked in the sandbox, so the renders use the Georgia fallback. Renders are in `renders/`. Not wired: the "Other date" picker, and real prep calls (the agenda is canned).

## Files

- `prototype.html`: open in a browser. The top bar switches direction, jumps to any step and restarts. `?dir=B&step=4` deep-links.
- `renders/`: step screenshots for both directions at 1440 and 390.
