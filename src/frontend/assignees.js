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

export const TOTAL_LINE_COLOR = '#D2042D';
export const UNASSIGNED_LINE_COLOR = '#F4A3A8';
export const OVERFLOW_LINE_COLOR = '#B3BAC5';

// Pastel colours for the named people, in the order they are handed out: dark shade first, then light.
export const LINE_PALETTE = [
  { name: 'violet', shades: ['#A992D6', '#D3C7EE'] },
  { name: 'blue', shades: ['#7FAEE0', '#BBD6F3'] },
  { name: 'green', shades: ['#86C79A', '#BFE6C9'] },
  { name: 'orange', shades: ['#F3A869', '#F9D3AE'] },
  { name: 'yellow', shades: ['#EBCB5C', '#F7E7A3'] },
];

// Colour of the person at this rank (0 = most open tickets). Whoever does not fit into the palette gets gray.
export function lineColorForRank(rank) {
  const shades = LINE_PALETTE.flatMap((color) => color.shades);
  return shades[rank] ?? OVERFLOW_LINE_COLOR;
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

  // Unassigned always comes first, then the people with the most tickets.
  return [...counts.values()].sort(
    (a, b) => Number(b.unassigned) - Number(a.unassigned) || b.count - a.count || a.label.localeCompare(b.label)
  );
}
