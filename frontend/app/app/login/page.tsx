"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { landingPath } from "@/lib/auth-landing";

const PASSWORD_KEY = "tsp:signs-in-with-password";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"magic-link" | "password">("magic-link");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The password option is only offered to someone who already signs in with
  // one: a new manager has no password, and trying one only earns Supabase's
  // "Invalid login credentials" (docs/ONBOARDING_SCOPING.md, §4.1). It shows
  // after a password sign-in on this browser, or with /app/login?password.
  const [passwordOffered, setPasswordOffered] = useState(false);
  useEffect(() => {
    let remembered = false;
    try {
      remembered = window.localStorage.getItem(PASSWORD_KEY) === "1";
    } catch {}
    setPasswordOffered(remembered || searchParams.has("password"));
    if (searchParams.has("password")) setMethod("password");
  }, [searchParams]);

  // Show an error if the auth routes redirected here with ?error=
  useEffect(() => {
    if (searchParams.get("error")) {
      setError("That login link didn't work. It may have expired or already been used. Send a new one below.");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    if (method === "password") {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) {
        setError(
          /invalid login credentials/i.test(authError.message)
            ? "That email and password don't match an account. New here? Use the login link instead."
            : authError.message
        );
        setLoading(false);
        return;
      }
      try {
        window.localStorage.setItem(PASSWORD_KEY, "1");
      } catch {}
      // Same landing as the emailed link: a manager with no direct reports
      // goes straight to first run, not through an 8-second dashboard shell.
      const next = await landingPath(supabase);
      router.replace(next);
      router.refresh();
      return;
    }

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Must match a URL in your Supabase project's "Redirect URLs" allow-list.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">Sign in or create your account</h1>
      <p className="mt-2 text-ink-secondary">
        {method === "magic-link"
          ? "We'll email you a login link, no password needed. New here? The same link creates your account."
          : "Use the email and password for your account."}
      </p>

      {sent ? (
        <div className="mt-8">
          <p className="text-ink-body">
            Check <strong>{email}</strong> for a login link. It expires in 1 hour.
          </p>
          <button
            onClick={() => { setSent(false); setEmail(""); }}
            className="mt-4 text-sm text-ink-secondary underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-md border border-control px-4 py-2 focus:border-brand focus:outline-none"
          />
          {method === "password" && (
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-md border border-control px-4 py-2 focus:border-brand focus:outline-none"
            />
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading || !email.trim() || (method === "password" && !password)}
            className="w-full rounded-md bg-brand px-4 py-2 text-on-brand disabled:opacity-40"
          >
            {loading
              ? method === "magic-link" ? "Sending…" : "Signing in…"
              : method === "magic-link" ? "Send login link" : "Sign in"}
          </button>
          {passwordOffered && <button
            type="button"
            onClick={() => {
              setMethod(method === "magic-link" ? "password" : "magic-link");
              setPassword("");
              setError(null);
            }}
            className="w-full text-sm text-ink-secondary underline hover:text-ink"
          >
            {method === "magic-link" ? "Use a password instead" : "Use a login link instead"}
          </button>}
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
