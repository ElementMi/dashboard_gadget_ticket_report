const UNASSIGNED_LABEL = 'Unassigned';

// Colour level of a box.
// Assignees: under 5 = low (blue), under 10 = mid (green), 10 or more = high (red/pink).
// Unassigned: under 10 = low, under 20 = mid, under 30 = warn (yellow), 30 or more = high.
export function levelFor(count, unassigned = false) {
  if (unassigned) {
    if (count < 10) return 'low';
    if (count < 20) return 'mid';
    if (count < 30) return 'warn';
    return 'high';
  }

  if (count < 5) return 'low';
  if (count < 10) return 'mid';
  return 'high';
}

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
