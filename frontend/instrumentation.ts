// Next.js calls register() once per server runtime at startup.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

// Errors thrown while rendering on the server.
export const onRequestError = Sentry.captureRequestError;
