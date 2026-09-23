/** @type {import('next').NextConfig} */
const MARKETING_SITE = "https://www.thesamepage.xyz";

const nextConfig = {
  reactStrictMode: true,

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

module.exports = nextConfig;
