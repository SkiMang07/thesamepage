"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show an error if the auth callback redirected here with ?error=
  useEffect(() => {
    if (searchParams.get("error")) {
      setError("The login link didn't work — it may have expired. Try again.");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
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
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-gray-500">We'll send you a magic link — no password needed.</p>

      {sent ? (
        <div className="mt-8">
          <p className="text-gray-700">
            Check <strong>{email}</strong> for a login link. It expires in 1 hour.
          </p>
          <button
            onClick={() => { setSent(false); setEmail(""); }}
            className="mt-4 text-sm text-gray-500 underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none"
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-white disabled:opacity-40"
          >
            {loading ? "Sending…" : "Send login link"}
          </button>
        </form>
      )}
    </main>
  );
}
