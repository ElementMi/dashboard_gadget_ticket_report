// Tickets created per group: last year (the whole year) against this year (so far).
import { parseJiraDate } from './statuses.js';

const yearFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric' });

function yearOfTicket(created) {
  const date = parseJiraDate(created);
  return Number.isNaN(date.getTime()) ? null : Number(yearFormatter.format(date));
}

// tickets: the tickets of the diagram. groups: groupTickets(tickets), with groups.labelOf[i] = group of tickets[i].
export function buildYearComparison(tickets, groups, now = new Date()) {
  const thisYear = Number(yearFormatter.format(now));
  const lastYear = thisYear - 1;
  const labelOf = groups.labelOf ?? [];

  const byLabel = new Map(groups.map((group) => [group.label, { label: group.label, last: 0, current: 0 }]));
  const total = { last: 0, current: 0 };

  tickets.forEach((ticket, index) => {
    const row = byLabel.get(labelOf[index]);
    if (!row) return;
    const year = yearOfTicket(ticket.created);
    if (year === lastYear) {
      row.last += 1;
      total.last += 1;
    } else if (year === thisYear) {
      row.current += 1;
      total.current += 1;
    }
  });

  // Same order as the diagram.
  return { thisYear, lastYear, rows: groups.map((group) => byLabel.get(group.label)), total };
}
