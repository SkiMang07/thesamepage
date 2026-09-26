// What the Relationship view's "Growth direction" preview shows (A4). Pure,
// no imports, so Node's test runner can load it.
//
// When there is no saved plan, the preview offers the AI draft in place, so a
// manager never has to find it on the Growth tab. The draft itself is still
// draft-then-review: it appears as a suggestion to use or dismiss.

type DevelopmentLike = {
  development_plan: { plan_text: string | null };
  aspiration?: { desired_role?: string | null } | null;
} | null;

export type GrowthDirection =
  | { kind: "failed" }
  | { kind: "loading" }
  | { kind: "plan"; text: string; offerDraft: false }
  | { kind: "aspiration"; text: string; offerDraft: true }
  | { kind: "none"; offerDraft: true };

export function growthDirection(development: DevelopmentLike, failed: boolean): GrowthDirection {
  if (failed) return { kind: "failed" };
  if (!development) return { kind: "loading" };
  const plan = development.development_plan.plan_text?.trim() ?? "";
  if (plan) return { kind: "plan", text: plan, offerDraft: false };
  const aspiration = development.aspiration?.desired_role?.trim() ?? "";
  if (aspiration) return { kind: "aspiration", text: aspiration, offerDraft: true };
  return { kind: "none", offerDraft: true };
}

export function draftPrompt(firstName: string): string {
  return `Draft one from ${firstName}'s 1:1s and assessments`;
}
