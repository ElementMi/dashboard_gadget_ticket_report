const UNASSIGNED_LABEL = 'Unassigned';

// One entry per assignee found in the JQL result, biggest first.
// Tickets without an assignee (or without a readable name) share one "Unassigned" entry.
export function toAssigneeCounts(issues) {
  const counts = new Map();

  for (const issue of issues ?? []) {
    const assignee = issue?.fields?.assignee;
    const name = assignee?.displayName?.trim();
    const key = name ? (assignee.accountId ?? name) : UNASSIGNED_LABEL;
    const label = name || UNASSIGNED_LABEL;

    const entry = counts.get(key) ?? { key, label, count: 0, unassigned: !name };
    entry.count += 1;
    counts.set(key, entry);
  }

  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
