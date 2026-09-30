// How a person in the org is named in pickers and "Led by" lines.
// The caller is "You" (with their name when they gave one). An email is the
// last resort for someone else, never the label for the person looking at it.

export function memberLabel(member: { full_name: string; email: string; is_you?: boolean }): string {
  const name = member.full_name.trim();
  if (member.is_you) return name ? `You (${name})` : "You";
  return name || member.email;
}

// For "Led by …": "Led by you" reads better than "Led by You".
export function ledByLabel(member: { full_name: string; email: string; is_you?: boolean }): string {
  return member.is_you && !member.full_name.trim() ? "you" : memberLabel(member);
}
