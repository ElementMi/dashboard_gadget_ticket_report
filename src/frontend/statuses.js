// Status groups for the heatmap columns, in the order they appear from the y axis outwards.
// SUP and ESUP use different words for the same thing (Solved / Resolved / Closed, Waiting for requester /
// Waiting for customer, ...), so statuses are mapped to five groups. Names are compared in lower case.
// German names are included in case Jira ever returns them.
//
// reversed: true  ->  the colour scale runs the other way round (many tickets = dark), because a big number
// of waiting or solved tickets is not a problem, unlike a big number of open or in-progress tickets.
export const STATUS_GROUPS = [
  {
    label: 'Change request',
    reversed: false,
    names: ['change request / data clearance'],
  },
  {
    label: 'In progress',
    reversed: false,
    names: [
      'in progress',
      'cause analysis',
      'software modification',
      'wartung_nacht_3rd_soldev-team',
      'wartung_nacht_3rd_systemtechnik',
      "we're investigating",
      'commissioning',
      'as upgrade',
    ],
  },
  {
    label: 'New / open',
    reversed: false,
    names: ['open', 'reopened', 'waiting for support'],
  },
  {
    label: 'Waiting for customer',
    reversed: true,
    names: [
      'waiting for requester',
      'waiting for customer',
      'customer testing',
      'awaiting approval',
      'waiting for approval',
      'waiting for third parties',
      'waiting for solution',
      'spare parts on the way',
      'residue on order',
      'work planned',
      'service planned',
      'ready for deploy',
      'deployed',
    ],
  },
  {
    label: 'Solved / closed',
    reversed: true,
    names: [
      'solved',
      'solved (problem)',
      'resolved',
      'resolved warranty-accepted',
      'resolved warranty-rejected',
      'closed',
      'return to vendor',
      'gelöst',
      'gelöst (problem)',
      'geschlossen',
    ],
  },
];

// A status that is not on the list falls back to Jira's own category: new, indeterminate (in progress) or done.
const FALLBACK_BY_CATEGORY = {
  new: 'New / open',
  indeterminate: 'In progress',
  done: 'Solved / closed',
};

const GROUP_BY_NAME = new Map();
for (const group of STATUS_GROUPS) {
  for (const name of group.names) GROUP_BY_NAME.set(name, group.label);
}

export function statusGroupFor(statusName, categoryKey) {
  const name = (statusName ?? '').toLowerCase().replace(/[‘’]/g, "'").trim();
  return GROUP_BY_NAME.get(name) ?? FALLBACK_BY_CATEGORY[categoryKey] ?? 'In progress';
}

// Rows of the heatmap: how long ago the ticket was created.
export const AGE_BUCKETS = [
  { label: 'Under 4 weeks', from: 0, to: 28 },
  { label: '4 weeks to 3 months', from: 28, to: 90 },
  { label: '3 to 12 months', from: 90, to: 365 },
  { label: 'Over 1 year', from: 365, to: Infinity },
];

// Jira writes the time zone as +0200; some browsers need +02:00.
export function parseJiraDate(value) {
  return new Date(String(value).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
}

export function ageInDays(created, now = new Date()) {
  const date = parseJiraDate(created);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / 86400000);
}

// Returns the table with one colour scale per kind of column: the open-work columns share one maximum and the
// reversed columns (waiting, solved) share another, so a huge "solved" number does not wash out the rest.
export function buildAgeStatusTable(tickets, now = new Date()) {
  const columns = STATUS_GROUPS.map((group) => ({ label: group.label, reversed: group.reversed }));
  const counts = AGE_BUCKETS.map(() => columns.map(() => 0));

  for (const ticket of tickets) {
    const days = ageInDays(ticket.created, now);
    if (days === null) continue;
    const row = AGE_BUCKETS.findIndex((bucket) => days >= bucket.from && days < bucket.to);
    const label = statusGroupFor(ticket.status, ticket.category);
    const column = columns.findIndex((c) => c.label === label);
    if (row >= 0 && column >= 0) counts[row][column] += 1;
  }

  let maxOpenWork = 1;
  let maxReversed = 1;
  counts.forEach((row) =>
    row.forEach((count, index) => {
      if (columns[index].reversed) maxReversed = Math.max(maxReversed, count);
      else maxOpenWork = Math.max(maxOpenWork, count);
    })
  );

  const rows = AGE_BUCKETS.map((bucket, index) => ({ label: bucket.label, cells: counts[index] }));
  const total = counts.flat().reduce((sum, count) => sum + count, 0);
  return { rows, columns, maxOpenWork, maxReversed, total };
}

// For the note under the diagram: which status of which project lands in which group (same order as the columns).
export const STATUS_GROUP_DETAILS = [
  { label: 'Change request', sup: ['Change Request / Data clearance'], esup: [] },
  {
    label: 'In progress',
    sup: ['In progress', 'Cause analysis', 'Software modification', 'Wartung_Nacht_3rd_SolDev-Team', 'Wartung_Nacht_3rd_Systemtechnik'],
    esup: ['In Progress', "We're Investigating", 'Commissioning', 'AS Upgrade'],
  },
  { label: 'New / open', sup: ['Open', 'Reopened', 'Waiting for Support'], esup: ['Open'] },
  {
    label: 'Waiting for customer',
    sup: ['Waiting for requester'],
    esup: [
      'Waiting for customer',
      'Customer testing',
      'Awaiting approval',
      'Waiting for approval',
      'Waiting for third parties',
      'Waiting for solution',
      'Spare parts on the way',
      'Residue on order',
      'Work planned',
      'Service planned',
      'Ready for Deploy',
      'Deployed',
    ],
  },
  {
    label: 'Solved / closed',
    sup: ['Solved', 'Solved (Problem)', 'Closed'],
    esup: ['Resolved', 'Resolved Warranty-Accepted', 'Resolved Warranty-Rejected', 'Closed', 'Return to Vendor'],
  },
];
