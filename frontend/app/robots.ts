import type { MetadataRoute } from "next";

// The app domain holds nothing a search engine should index: the public
// site is HubSpot (www.thesamepage.xyz), and everything here is sign-in or
// behind it.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
