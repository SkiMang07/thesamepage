/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    // components/ was missing here — every class used ONLY inside a
    // components/*.tsx file (never duplicated verbatim in app/ or lib/)
    // was silently dropped from the production CSS. Plain utility classes
    // (text-gray-400, rounded-md, etc.) happened to still work because
    // some page under app/ also used the same class string; ZoneMap.tsx's
    // and AppNav.tsx's one-off arbitrary values (h-[15px], bg-[#eef1ff],
    // text-[13px], ...) never appeared anywhere else, so they never
    // generated any CSS at all — the zone map rendered with huge unstyled
    // icons and no card/row styling in production while `next build`
    // still succeeded, because this is a content-purging gap, not a
    // compile error. Found live on thesamepage-blush.vercel.app after the
    // Session 37/38 push; see docs/SESSION_HISTORY.md.
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: { extend: {} },
  plugins: [],
};
