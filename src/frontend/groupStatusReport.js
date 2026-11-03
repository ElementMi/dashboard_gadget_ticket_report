// Data for the "group x status" report: one row per diagram group that still has open tickets.
import { ageInDays, statusGroupFor } from './statuses.js';

export const STATUS_COLUMNS = ['New / open', 'In progress', 'Waiting for customer', 'Change request', 'Solved / closed'];
export const PAGE_SIZE = 50;
const OTHER_LABEL = 'Other';
const SOLVED = 'Solved / closed';

// tickets: the tickets of the diagram. groups: the result of groupTickets(tickets), with groups.labelOf[i] = group of tickets[i].
export function buildReport(tickets, groups) {
  const labelOf = groups.labelOf ?? [];
  const byLabel = new Map();

  tickets.forEach((ticket, index) => {
    const label = labelOf[index] ?? OTHER_LABEL;
    if (!byLabel.has(label)) byLabel.set(label, { label, counts: STATUS_COLUMNS.map(() => 0), total: 0, open: [] });
    const row = byLabel.get(label);
    const status = statusGroupFor(ticket.status, ticket.category);
    const column = STATUS_COLUMNS.indexOf(status);
    if (column >= 0) row.counts[column] += 1;
    row.total += 1;
    if (status !== SOLVED) row.open.push({ ticket, column });
  });

  // Same order as the diagram (biggest first), "Other" last. Only groups with at least one open ticket.
  const order = groups.map((group) => group.label);
  const rank = (label) => (label === OTHER_LABEL ? Infinity : order.indexOf(label) === -1 ? order.length : order.indexOf(label));
  const rows = [...byLabel.values()].filter((row) => row.open.length > 0).sort((a, b) => rank(a.label) - rank(b.label));

  // Inside a group: by status column, then the ticket that has been open the longest first.
  for (const row of rows) {
    row.open.sort(
      (a, b) => a.column - b.column || (ageInDays(b.ticket.created) ?? 0) - (ageInDays(a.ticket.created) ?? 0)
    );
  }

  const totals = { counts: STATUS_COLUMNS.map(() => 0), total: 0, open: 0 };
  for (const row of rows) {
    row.counts.forEach((count, index) => (totals.counts[index] += count));
    totals.total += row.total;
    totals.open += row.open.length;
  }

  // All tickets of the diagram, and the part that is not listed (groups without an open ticket).
  const all = { counts: STATUS_COLUMNS.map(() => 0), total: 0 };
  for (const row of byLabel.values()) {
    row.counts.forEach((count, index) => (all.counts[index] += count));
    all.total += row.total;
  }
  const rest = {
    counts: all.counts.map((count, index) => count - totals.counts[index]),
    total: all.total - totals.total,
    groups: byLabel.size - rows.length,
  };
  return { rows, totals, rest, all };
}

// Pages of at most pageSize open tickets. A group that fits stays together on one page; a bigger group is split
// and shown again as "continued" on the next page.
export function paginate(rows, pageSize = PAGE_SIZE) {
  const pages = [];
  let current = [];
  let used = 0;
  const flush = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };

  for (const row of rows) {
    const size = row.open.length;
    if (size <= pageSize) {
      if (used + size > pageSize) flush();
      current.push({ row, items: row.open, continued: false });
      used += size;
    } else {
      flush();
      for (let start = 0; start < size; start += pageSize) {
        pages.push([{ row, items: row.open.slice(start, start + pageSize), continued: start > 0 }]);
      }
    }
  }
  flush();
  return pages;
}
