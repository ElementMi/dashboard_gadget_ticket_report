import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

const IMPACT_FIELD_NAMES = [
  'impact (migrated 2)[dropdown]',
  'Impact (migrated 2)[dropdown]',
  'impact',
  'Impact',
];

const ORGANIZATION_FIELD_NAMES = [
  'organization',
  'Organisation',
  'Organizations',
  'Organisationen',
];

const REACTION_FIELD_NAMES = [
  'Reaktionszeit',
  'Reaktionzeit',
  'Reaktionszeit (SLA)',
  'Time to first response',
  'First response time',
];

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

function toNamesMapFromFields(fieldDefinitions) {
  const namesMap = {};
  for (const field of fieldDefinitions ?? []) {
    if (field?.id && field?.name) {
      namesMap[field.id] = field.name;
    }
  }
  return namesMap;
}

function stripOrderByClause(jql) {
  return (jql ?? '').replace(/\s+order\s+by\b[\s\S]*$/i, '').trim();
}

function buildWindowScopedJql(searchJql, windowStart, windowEnd) {
  const base = stripOrderByClause(searchJql);
  return `(${base}) AND created >= "${windowStart}" AND created < "${windowEnd}" ORDER BY created DESC`;
}

async function loadAllIssues(searchJql, fieldsToRequest, maxPages = 25) {
  const issues = [];
  const pageSize = 500;
  let nextPageToken = null;
  let safetyCounter = 0;
  const seenTokens = new Set();

  do {
    const requestBody = {
      jql: searchJql,
      maxResults: pageSize,
      fields: fieldsToRequest,
    };

    if (nextPageToken) {
      requestBody.nextPageToken = nextPageToken;
    }

    const searchResponse = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!searchResponse.ok) {
      const searchError = await searchResponse.text();
      throw new Error(`Jira search failed (${searchResponse.status}): ${searchError}`);
    }

    const searchJson = await searchResponse.json();
    const pageIssues = searchJson.issues ?? [];
    issues.push(...pageIssues);

    const candidateToken = searchJson.nextPageToken ?? null;

    // Stop if Jira returns an already-seen token to avoid endless pagination loops.
    if (candidateToken && seenTokens.has(candidateToken)) {
      nextPageToken = null;
    } else {
      nextPageToken = candidateToken;
      if (nextPageToken) {
        seenTokens.add(nextPageToken);
      }
    }

    // No results means there is nothing left to fetch even if a token is present.
    if (!pageIssues.length) {
      nextPageToken = null;
    }

    safetyCounter += 1;
  } while (nextPageToken && safetyCounter < maxPages);

  return issues;
}

const OPEN_STATUS_CLAUSE = 'status WAS NOT IN (Closed, Resolved)';
const DAILY_COUNT_CONCURRENCY = 16;
const DAILY_COUNT_MAX_REQUESTS = 600;

function stripStatusClause(jql) {
  return stripOrderByClause(jql).replace(/\s+AND\s+status\s+NOT\s+IN\s*\([^)]*\)/i, '');
}

async function countIssues(jql) {
  const countResponse = await api.asApp().requestJira(route`/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jql }),
  });

  if (!countResponse.ok) {
    const countError = await countResponse.text();
    throw new Error(`Jira count failed (${countResponse.status}): ${countError}`);
  }

  const countJson = await countResponse.json();
  return countJson.count ?? 0;
}

// The frontend sends dates as "yyyy/MM/dd HH:mm"; day keys are "yyyy-MM-dd".
function toDayKey(jqlDate) {
  return jqlDate.slice(0, 10).replace(/\//g, '-');
}

// Past days only (the window start up to yesterday, never beyond the window end): today's point comes from the normal open-ticket query.
function listPastDays(windowStart, windowEnd, todayKey) {
  const days = [];
  const lastDayExclusive = toDayKey(windowEnd) < todayKey ? toDayKey(windowEnd) : todayKey;
  const cursor = new Date(`${toDayKey(windowStart)}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) < lastDayExclusive) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function loadDailyCounts(searchJql, people, days) {
  if (people.length * days.length > DAILY_COUNT_MAX_REQUESTS) {
    throw new Error(`Too many daily counts (${people.length} people x ${days.length} days).`);
  }

  const base = stripStatusClause(searchJql);
  const jobs = [];
  for (const person of people) {
    for (const day of days) {
      const pointInTime = `${day.replace(/-/g, '/')} 23:59`;
      const assigneeClause = person.accountId
        ? `assignee WAS "${person.accountId}" ON "${pointInTime}"`
        : `assignee WAS EMPTY ON "${pointInTime}"`;
      const jql = `(${base}) AND ${assigneeClause} AND ${OPEN_STATUS_CLAUSE} ON "${pointInTime}"`;
      jobs.push({ person, day, jql });
    }
  }

  const results = [];
  let nextJob = 0;
  async function worker() {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob];
      nextJob += 1;
      results.push({
        accountId: job.person.accountId,
        day: job.day,
        count: await countIssues(job.jql),
      });
    }
  }
  await Promise.all(Array.from({ length: DAILY_COUNT_CONCURRENCY }, worker));
  return results;
}

resolver.define('loadGadgetData', async ({ payload }) => {
  const searchJql = payload?.searchJql;
  const windowStart = payload?.windowStart;
  const windowEnd = payload?.windowEnd;

  if (!searchJql) {
    throw new Error('Missing search JQL.');
  }

  const fieldsResponse = await api.asApp().requestJira(route`/rest/api/3/field`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!fieldsResponse.ok) {
    const fieldsError = await fieldsResponse.text();
    throw new Error(`Jira fields lookup failed (${fieldsResponse.status}): ${fieldsError}`);
  }

  const fieldDefinitions = await fieldsResponse.json();
  const namesMap = toNamesMapFromFields(fieldDefinitions);

  const impactFieldId = findFieldIdByDisplayName(namesMap, IMPACT_FIELD_NAMES);
  const organizationFieldId = findFieldIdByDisplayName(namesMap, ORGANIZATION_FIELD_NAMES);
  const reactionFieldId = findFieldIdByDisplayName(namesMap, REACTION_FIELD_NAMES);

  const fieldsToRequest = [
    'created',
    'updated',
    'resolutiondate',
    'summary',
    'project',
    'assignee',
  ];

  if (impactFieldId) {
    fieldsToRequest.push(impactFieldId);
  }
  if (organizationFieldId) {
    fieldsToRequest.push(organizationFieldId);
  }
  if (reactionFieldId) {
    fieldsToRequest.push(reactionFieldId);
  }

  if (!windowStart || !windowEnd) {
    throw new Error('Missing timeframe window.');
  }

  const visibleWindowJql = buildWindowScopedJql(searchJql, windowStart, windowEnd);
  const openIssues = await loadAllIssues(searchJql, ['created', 'assignee'], 25);

  const peopleByKey = new Map();
  for (const issue of openIssues) {
    const accountId = issue.fields?.assignee?.accountId ?? null;
    if (!peopleByKey.has(accountId)) {
      peopleByKey.set(accountId, {
        accountId,
        displayName: issue.fields?.assignee?.displayName ?? 'Unassigned',
        openToday: 0,
      });
    }
    peopleByKey.get(accountId).openToday += 1;
  }
  const people = [...peopleByKey.values()];
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
  const dailyCounts = await loadDailyCounts(searchJql, people, listPastDays(windowStart, windowEnd, todayKey));

  return {
    issues: openIssues,
    people,
    dailyCounts,
    todayKey,
    visibleIssues: await loadAllIssues(visibleWindowJql, fieldsToRequest, 10),
    namesMap,
  };
});

export const handler = resolver.getDefinitions();
