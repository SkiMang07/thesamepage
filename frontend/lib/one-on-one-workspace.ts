import { Goal } from "@/lib/api";

export type OneOnOneSuggestion = { key: string; text: string };

function snippet(text: string, max = 110) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

// Live, reversible inputs for the next-meeting workspace. Commitments are
// deliberately absent: they are linked into prep as their own live records,
// never copied into a second talking-point list. Recent 1:1 history is also
// absent because the prep engine already reads it as grounding context; showing
// it here as removable would promise a control the prompt does not actually have.
export function deriveOneOnOneSuggestions({
  goals,
  planText,
}: {
  goals: Goal[];
  planText: string | null | undefined;
}): OneOnOneSuggestion[] {
  const suggestions: OneOnOneSuggestion[] = [];

  goals
    .filter((goal) => goal.status === "at_risk")
    .slice(0, 3)
    .forEach((goal) =>
      suggestions.push({ key: `goal-${goal.id}`, text: `${goal.title} is at risk` })
    );

  if (planText?.trim()) {
    suggestions.push({
      key: "development-plan",
      text: `Development: ${snippet(planText)}`,
    });
  }

  return suggestions;
}
