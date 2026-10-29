const IMPACT_FIELD_NAMES = ['impact (migrated 2)[dropdown]', 'Impact (migrated 2)[dropdown]', 'impact', 'Impact'];
const ORGANIZATION_FIELD_NAMES = ['organization', 'Organisation', 'Organizations', 'Organisationen'];
const BERLIN_TIMEZONE = 'Europe/Berlin';
const createdTableFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function normalizeLabel(value) {
  return (value ?? '').toString().trim().toLowerCase();
}

function findFieldIdByDisplayName(namesMap, candidateNames) {
  const wanted = candidateNames.map(normalizeLabel);
  for (const [fieldId, displayName] of Object.entries(namesMap ?? {})) {
    if (wanted.includes(normalizeLabel(displayName))) {
      return fieldId;
    }
  }
  return null;
}

function getFieldByNames(fields, namesMap, candidateNames) {
  const directMatch = candidateNames.find((name) => fields?.[name] !== undefined);
  if (directMatch) return fields[directMatch];

  const fieldId = findFieldIdByDisplayName(namesMap, candidateNames);
  if (fieldId && fields?.[fieldId] !== undefined) return fields[fieldId];

  return null;
}

function toDisplayValue(value) {
  if (value == null) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (!value.length) return '-';
    return value
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') return item.displayName ?? item.name ?? item.value ?? JSON.stringify(item);
        return String(item);
      })
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'object') {
    return value.displayName ?? value.name ?? value.value ?? JSON.stringify(value);
  }

  return String(value);
}

function formatDeltaFromMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';

  const totalMinutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function toVisibleIssuesWithNames(issues, window, namesMap) {
  const visible = [];

  for (const issue of issues ?? []) {
    const created = issue?.fields?.created;
    if (!created) continue;

    const createdDate = new Date(created);
    if (Number.isNaN(createdDate.getTime())) continue;
    if (createdDate < window.start || createdDate >= window.end) continue;

    const fields = issue?.fields ?? {};
    const impactValue = getFieldByNames(fields, namesMap, IMPACT_FIELD_NAMES);
    const organizationValue = getFieldByNames(fields, namesMap, ORGANIZATION_FIELD_NAMES);
    const updatedDate = fields?.updated ? new Date(fields.updated) : null;
    const closedDate = fields?.resolutiondate ? new Date(fields.resolutiondate) : null;
    const hasValidUpdated = updatedDate instanceof Date && !Number.isNaN(updatedDate.getTime());
    const hasValidClosed = closedDate instanceof Date && !Number.isNaN(closedDate.getTime());
    const deltaMs = hasValidClosed ? closedDate.getTime() - createdDate.getTime() : NaN;

    visible.push({
      key: issue.key,
      project: fields?.project?.key ?? '-',
      impact: toDisplayValue(impactValue),
      assignee: fields?.assignee?.displayName ?? 'Unassigned',
      summary: fields?.summary ?? '(no summary)',
      organization: toDisplayValue(organizationValue),
      createdDisplay: createdTableFormatter.format(createdDate),
      deltaDisplay: formatDeltaFromMs(deltaMs),
      createdRaw: createdDate.toISOString(),
      updatedDisplay: hasValidUpdated ? createdTableFormatter.format(updatedDate) : '-',
      closedDisplay: hasValidClosed ? createdTableFormatter.format(closedDate) : '-',
    });
  }

  return visible;
}

