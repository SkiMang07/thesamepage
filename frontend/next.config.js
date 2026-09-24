/** @type {import('next').NextConfig} */
const MARKETING_SITE = "https://www.thesamepage.xyz";

// Security headers (PRELAUNCH_BACKLOG §7 C). Applied to every response.
//
// The CSP ships as Content-Security-Policy-Report-Only: the browser logs what
// it WOULD block to the console and blocks nothing. Flip the header name to
// Content-Security-Policy once a signed-in walk of the app (login, a prep
// sheet, dictation) shows no violations. What it must allow:
//   - connect-src: Supabase (auth + REST, https and wss) and the Railway API.
//     Both come from the same env vars lib/supabase.ts and lib/api.ts read,
//     so a new backend URL can't be forgotten here.
//   - script-src 'unsafe-inline': Next's App Router inlines its hydration
//     payload. Tightening this needs nonces from middleware; not worth it yet.
//   - vercel.live: the feedback toolbar Vercel injects on preview deploys.
// The microphone is allowed for this origin only (Permissions-Policy), which
// is what NoteField's dictation needs; camera and location are off.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://*.supabase.co";
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://vercel.live`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE_URL} ${SUPABASE_URL.replace(/^https:/, "wss:")} ${BACKEND_URL} https://vercel.live`,
  "media-src 'self' blob:",
  "frame-src https://vercel.live",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig = {
  reactStrictMode: true,

  // PostHog's capture paths end in a slash (/i/v0/e/). Without this, Next
  // 308-redirects /ingest/i/v0/e/ to the slashless path and events are lost.
  skipTrailingSlashRedirect: true,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // Uptime check (PRELAUNCH_BACKLOG §7 D). Sentry's uptime monitor watches
  // app.thesamepage.xyz/health, which proxies to the API's /health. Sentry
  // refuses to monitor *.railway.app (the shared domain hit its per-domain
  // limit), and going through this domain also checks the path a customer's
  // browser takes: Vercel, then Railway.
  //
  // Product analytics (same section). PostHog's browser SDK posts to /ingest
  // on this domain and it is forwarded to PostHog's US cloud, the same idea
  // as Sentry's /monitoring tunnel: no PostHog host in the CSP, and fewer
  // events lost to ad blockers. See lib/analytics.ts.
  async rewrites() {
    return [
      { source: "/health", destination: `${BACKEND_URL}/health` },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },

  // The marketing site is HubSpot (www.thesamepage.xyz). This app serves only
  // /app, /auth and /invite. Anything that used to be a marketing page here
  // goes to the real one, so the app domain never shows a second homepage.
  async redirects() {
    return [
      { source: "/", destination: "/app/login", permanent: false },
      { source: "/pricing", destination: `${MARKETING_SITE}/`, permanent: true },
      { source: "/blog", destination: `${MARKETING_SITE}/blog`, permanent: true },
      { source: "/blog/:path*", destination: `${MARKETING_SITE}/blog/:path*`, permanent: true },
    ];
  },
};

// Sentry (PRELAUNCH_BACKLOG §7 D). Browser events go to /monitoring on this
// domain and are forwarded to Sentry from there, so ad blockers don't drop
// them and the CSP needs no Sentry host. Source maps are uploaded (and kept
// out of the public bundle) only when SENTRY_AUTH_TOKEN is set on Vercel;
// without it the build still succeeds and stack traces are minified.
const { withSentryConfig } = require("@sentry/nextjs/config");

module.exports = withSentryConfig(nextConfig, {
  org: "the-same-page",
  project: "thesamepage-frontend",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  telemetry: false,
  webpack: { treeshake: { removeDebugLogging: true } },
});
