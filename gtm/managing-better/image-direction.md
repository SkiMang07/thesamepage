# Managing Better — image direction

Managing Better extends the website's locked **Soft** illustration register into
editorial images. It is fun through the clarity of the metaphor and the small visual
surprise, not through cartoon faces, jokes or decorative noise.

Read `website/docs/build-process.md` → The illustration register — Soft and
`docs/systems/brand.md` before generating or approving an image.

## The hand

- Draw records, surfaces, marks and the traces people leave behind. No people,
  faces, hands, mascots or office scenes.
- Use one idea per image. The picture should still read at a small listing-card size.
- Prefer calm editorial composition, soft geometry, generous negative space and a
  lightly tactile finish over glossy 3D or generic flat-vector stock art.
- A record is a filled surface, not an outline. Writing is represented by pills.
- A filled rounded square is a recorded or agreed mark. A circle identifies whose
  record it is. Preserve those meanings rather than using the shapes decoratively.
- Never bake a headline, label, quotation or logo into the bitmap.

## Colour

- Light canvas, carbon structure, primary teal for agreement or identity, and amber
  for something still open.
- Blue is reserved for a genuinely AI-specific concept. It is not a decorative
  accent.
- Every image needs at least one saturated element at rest so it reads as finished,
  not as a loading skeleton.
- Do not introduce a new hue because the topic feels like it needs variety.

## Deliverables

Every post receives one featured image. Add one inline image only when it explains a
framework, sequence or contrast that prose handles poorly.

The shared HubSpot theme renders the featured image below the post byline and in the
main and related-post cards, using the same crop-safe 16:9 composition. The author
does not paste that image into `post.html`. The publisher attaches it to the native
HubSpot featured-image field, and the templates supply its URL and alt text.

The featured composition must be crop-safe for a wide social/listing crop, with the
meaningful object away from the extreme edges. Preserve a high-resolution master and
derive any alternate aspect ratio from the approved composition rather than asking a
model to reinvent it.

Each image ships with:

- a plain-language art brief tied to the post's thesis;
- final file path and intended role;
- concise alt text describing the meaningful visual content;
- an empty alt attribute only when the image is truly decorative;
- confirmation that there is no embedded text and no off-palette colour.

## Never use

- robots, brains, magic wands, glowing circuitry or AI sparkles;
- handshakes, ladders with people, target boards, megaphones or puzzle pieces;
- fake product UI presented as a real screenshot;
- tiny decorative details that collapse in the blog index;
- photorealistic people or pseudo-candid office photography;
- a second image merely to break up a long post.

The first three approved featured images form the calibration set. Revisit this file
only when those real outputs demonstrate a rule the current direction does not cover.
