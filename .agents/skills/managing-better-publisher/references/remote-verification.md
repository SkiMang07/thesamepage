# Remote verification

API verification proves that HubSpot retained the intended fields and semantic body.
It does not prove the real template rendered correctly.

## Semantic check

Run the script's `verify` command. It must confirm:

- title, HTML title, slug, summary, meta description, author, blog and tag IDs;
- featured image URL and alt text;
- the ordered body structure, visible text, links and inline-image URLs;
- no remote drift from the last version written by the publisher.

Do not dismiss a mismatch as HubSpot normalization until the actual difference is
understood. Update the comparison only when HubSpot's transformation is harmless and
repeatable.

## Visual check

Open the draft preview in an authenticated browser. Inspect the real blog template at
desktop and phone widths. Confirm:

- title, lede, author, date and kind tape;
- the contract box appears only for a blockquote containing a list;
- every H3 step is numbered in order without a typed duplicate number;
- script blocks preserve line breaks and receive the generated label;
- pull quotes are not promoted into contract boxes;
- the featured image loads below the byline, uses the approved alt text, crops cleanly
  to the shared 16:9 frame and does not overflow;
- the same featured image appears on the post's Main List View card and on a
  related-post card when that surface is populated;
- every inline image, when justified, loads in its intended body position with the
  approved alt text and without overflow;
- links point to the expected destinations;
- no raw placeholder, class name, HTML entity or source note is visible;
- the closing bands and related-post area still render.

Preview the index for every new post. Confirm the card's format treatment, title,
summary, date and featured-image behavior. A browser-reported image node is not
enough: confirm it completed loading with non-zero natural dimensions at both desktop
and phone widths.

## Approval state

Record `verified` only when both checks pass. If browser control is unavailable, hand
the preview URL to Andrew and keep the post in `HubSpot draft` until he confirms the
visual result. Do not publish on API verification alone.
