// The Same Page · people kit
// One generator for every figure on the site. Output is static SVG markup (no JS ships).
// Figures are faceless and drawn in the site's own material: flat fills, rounded shapes,
// the theme's soft shadow on surfaces. Proportions are fixed here so every scene matches.

export const TOPS = { you:'#087E78', indigo:'#5A6190', plum:'#7E6A94', slate:'#4F6D7A', olive:'#6F7F55', clay:'#A8665A', charcoal:'#3D4A56', sand:'#B89B72' };

// The cast. Names match the example data used across the homepage.
export const CAST = {
  you:    { name:'You',          skin:'#B97A56', hair:'curly',  hairC:'#2A1E18', top:TOPS.you },
  maya:   { name:'Maya Reyes',   skin:'#C68E6A', hair:'long',   hairC:'#2B1D17', top:TOPS.indigo },
  james:  { name:'James Kim',    skin:'#E8C39E', hair:'short',  hairC:'#1C1C1F', top:TOPS.slate },
  priya:  { name:'Priya Shah',   skin:'#A86F4C', hair:'bun',    hairC:'#17120F', top:TOPS.plum },
  sam:    { name:'Sam Okafor',   skin:'#6B4430', hair:'fade',   hairC:'#1A1210', top:TOPS.olive, beard:true },
  alex:   { name:'Alex Byrne',   skin:'#F1D3BC', hair:'short',  hairC:'#B5562E', top:TOPS.charcoal },
  nina:   { name:'Nina Mensah',  skin:'#5A3726', hair:'afro',   hairC:'#1B1411', top:TOPS.clay },
  theo:   { name:'Theo Larsen',  skin:'#EFC8A8', hair:'short',  hairC:'#C9A15B', top:TOPS.sand, glasses:true },
  dana:   { name:'Dana Kowalski',skin:'#E3B48F', hair:'bob',    hairC:'#9AA0A6', top:TOPS.charcoal },
};

// Head r=22. Everything is relative to the head centre (0,0). Torso is slim: 64 wide.
const back = {
  long:  c=>`<rect x="-26" y="-20" width="52" height="66" rx="22" fill="${c}"/>`,
  bob:   c=>`<rect x="-27" y="-22" width="54" height="44" rx="20" fill="${c}"/>`,
  afro:  c=>`<circle cx="0" cy="-6" r="33" fill="${c}"/>`,
  bun:   c=>`<circle cx="0" cy="-29" r="10" fill="${c}"/>`,
};
const front = {
  short: c=>`<path d="M-22.5 1 C-24 -19 -9 -26 2 -25 C15 -24 24 -15 22.5 1 C17 -9 8 -12 -1 -12 C-10 -12 -18 -7 -22.5 1Z" fill="${c}"/>`,
  fade:  c=>`<path d="M-21.5 -6 C-20 -20 -8 -24 1 -24 C12 -24 21 -18 21.5 -6 C14 -13 7 -15 0 -15 C-7 -15 -15 -12 -21.5 -6Z" fill="${c}"/>`,
  long:  c=>`<path d="M-23 4 C-24 -18 -9 -26 2 -25 C15 -24 24 -15 23 4 C20 -6 12 -13 4 -14 C-6 -12 -16 -6 -23 4Z" fill="${c}"/>`,
  bob:   c=>`<path d="M-23 2 C-24 -18 -9 -26 2 -25 C15 -24 24 -15 23 2 C15 -10 -2 -14 -23 2Z" fill="${c}"/>`,
  bun:   c=>`<path d="M-22 -2 C-22 -19 -9 -25 1 -25 C12 -25 22 -19 22 -2 C15 -11 8 -14 0 -14 C-8 -14 -15 -11 -22 -2Z" fill="${c}"/>`,
  afro:  c=>`<path d="M-22 -1 C-21 -14 -11 -20 0 -20 C11 -20 21 -14 22 -1 C14 -8 7 -10 0 -10 C-7 -10 -14 -8 -22 -1Z" fill="${c}"/>`,
  curly: c=>`<g fill="${c}"><circle cx="-15" cy="-13" r="9"/><circle cx="-4" cy="-19" r="10"/><circle cx="9" cy="-18" r="10"/><circle cx="17" cy="-9" r="8"/><circle cx="-20" cy="-3" r="6"/><circle cx="21" cy="0" r="5"/></g>`,
};

// A bust: head, neck and shoulders. `h` is how far the torso runs below the chin.
export function bust(p, {x=0, y=0, s=1, h=110}={}) {
  const beard = p.beard ? `<path d="M-19 5 Q-17 24 0 26 Q17 24 19 5 Q11 14 0 14 Q-11 14 -19 5Z" fill="${p.hairC}"/>` : '';
  const glasses = p.glasses ? `<g fill="none" stroke="#2B2F33" stroke-width="2"><rect x="-17" y="-3" width="13" height="9" rx="3"/><rect x="4" y="-3" width="13" height="9" rx="3"/><path d="M-4 1 h8"/></g>` : '';
  return `<g transform="translate(${x} ${y}) scale(${s})">`
    + (back[p.hair]?back[p.hair](p.hairC):'')
    + `<rect x="-32" y="30" width="64" height="${h}" rx="26" fill="${p.top}"/>`
    + `<path d="M-9 30 Q0 40 9 30Z" fill="${p.skin}" opacity=".9"/>`
    + `<rect x="-7" y="16" width="14" height="18" rx="6" fill="${p.skin}"/>`
    + `<circle cx="0" cy="0" r="22" fill="${p.skin}"/>`
    + beard + (front[p.hair]?front[p.hair](p.hairC):'') + glasses
    + `</g>`;
}

// An avatar: the bust cropped into a circle, for conversation scenes and lists.
let aid = 0;
export function avatar(p, {x=0, y=0, r=40, bg='#E4EEEC'}={}) {
  const id = `av${++aid}`;
  return `<g transform="translate(${x} ${y})"><clipPath id="${id}"><circle r="${r}"/></clipPath>`
    + `<circle r="${r}" fill="${bg}"/><g clip-path="url(#${id})">${bust(p,{y:-r*0.12,s:r/48,h:90})}</g></g>`;
}
