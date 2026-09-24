"use client";

// Last-resort boundary for errors in the root layout itself. Everything under
// /app/* is caught first by app/app/error.tsx, which keeps the nav usable;
// this only renders if the shell around it fails. It must bring its own
// <html> and <body> because it replaces the root layout.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong on our side.</h1>
        <p style={{ marginTop: 8, color: "#555" }}>
          Nothing you saved has been lost. <a href="/app/dashboard">Reload The Same Page</a>.
        </p>
        {error.digest && <p style={{ marginTop: 16, fontSize: 12, color: "#888" }}>Reference: {error.digest}</p>}
      </body>
    </html>
  );
}
