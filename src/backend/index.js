import Resolver from '@forge/resolver';
import api, { route, fetch as externalFetch } from '@forge/api';

const resolver = new Resolver();

// Same paged search as the CFG gadget: Jira returns a next-page token until everything is loaded.
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

const ORGANIZATION_FIELD_NAMES = ['organization', 'organisation', 'organizations', 'organisationen'];

// The organization is a custom field; find its id by display name, like the CFG gadget does.
async function findOrganizationFieldId() {
  const response = await api.asApp().requestJira(route`/rest/api/3/field`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const definitions = await response.json();
  const match = (definitions ?? []).find((field) =>
    ORGANIZATION_FIELD_NAMES.includes((field.name ?? '').toString().trim().toLowerCase())
  );
  return match?.id ?? null;
}

function toNames(value) {
  if (!Array.isArray(value) || !value.length) return '-';
  return value.map((item) => item?.name ?? item?.displayName ?? item?.value ?? '').filter(Boolean).join(', ') || '-';
}

function plainText(node) {
  if (!node) return '';
  if (node.text) return node.text;
  return (node.content ?? []).map(plainText).join(' ');
}

// Description as a short plain-text hint for sorting: no greeting, no closing (that is where the names are).
function descriptionExcerpt(description) {
  return plainText(description)
    .replace(/\s+/g, ' ')
    .replace(/\b(mit freundlichen gr(ü|ue)ßen|freundliche gr(ü|ue)ße|viele gr(ü|ue)ße|vielen dank|danke|gruß|lg)\b.*$/i, '')
    .replace(/^(guten (morgen|tag|abend)|hallo|hi|moin|mahlzeit|servus)[^,.!:]{0,40}[,.!:]?\s*/i, '')
    .trim()
    .slice(0, 300);
}

// ---- YouTrack (read-only): the tickets of the YouTrack projects of an organization -------------------------------
const YOUTRACK_BASE = 'https://sup-logistik.myjetbrains.com/youtrack';
const REPORT_COLUMNS = ['New / open', 'In progress', 'Waiting for customer', 'Change request', 'Solved / closed'];
// YouTrack state -> column of the report. Everything unresolved that is not listed here counts as New / open.
const YOUTRACK_STATE_COLUMN = { 'in progress': 'In progress', 'to verify': 'Waiting for customer' };

function youtrackColumn(resolved, stateName) {
  if (resolved) return 'Solved / closed';
  return YOUTRACK_STATE_COLUMN[(stateName ?? '').toLowerCase()] ?? 'New / open';
}

function customFieldValue(issue, fieldName) {
  const field = (issue.customFields ?? []).find((candidate) => candidate.name === fieldName);
  const value = field?.value;
  return Array.isArray(value) ? value[0]?.fullName ?? value[0]?.name ?? '' : value?.fullName ?? value?.name ?? '';
}

resolver.define('loadYoutrackReport', async ({ payload }) => {
  const token = process.env.YOUTRACK_TOKEN;
  if (!token) return { available: false, reason: 'no token' };

  const projects = (payload?.projects ?? []).filter((name) => /^[A-Za-z0-9_]{1,12}$/.test(name));
  if (!projects.length) return { available: false, reason: 'no projects' };

  const issues = [];
  for (let skip = 0; skip < 5000; skip += 100) {
    const url = new URL(`${YOUTRACK_BASE}/api/issues`);
    url.searchParams.set('query', `project: ${projects.join(', ')}`);
    url.searchParams.set(
      'fields',
      'idReadable,summary,created,resolved,project(shortName,name),customFields(name,value(name,fullName))'
    );
    url.searchParams.set('$top', '100');
    url.searchParams.set('$skip', String(skip));
    const response = await externalFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) return { available: false, reason: `YouTrack answered ${response.status}` };
    const page = await response.json();
    issues.push(...page);
    if (page.length < 100) break;
  }

  const byProject = new Map();
  for (const issue of issues) {
    const shortName = issue.project?.shortName ?? '-';
    if (!byProject.has(shortName)) {
      byProject.set(shortName, {
        project: shortName,
        name: issue.project?.name ?? shortName,
        counts: REPORT_COLUMNS.map(() => 0),
        total: 0,
        open: [],
      });
    }
    const row = byProject.get(shortName);
    const state = customFieldValue(issue, 'State');
    const column = youtrackColumn(Boolean(issue.resolved), state);
    row.counts[REPORT_COLUMNS.indexOf(column)] += 1;
    row.total += 1;
    if (!issue.resolved) {
      row.open.push({
        key: issue.idReadable,
        summary: issue.summary ?? '',
        created: issue.created ? new Date(issue.created).toISOString() : null,
        state,
        column: REPORT_COLUMNS.indexOf(column),
        assignee: customFieldValue(issue, 'Assignee') || 'Unassigned',
      });
    }
  }
  return { available: true, baseUrl: YOUTRACK_BASE, projects: [...byProject.values()] };
});

resolver.define('loadReportData', async ({ payload }) => {
  const searchJql = payload?.searchJql;

  if (!searchJql) {
    throw new Error('Missing search JQL.');
  }

  const organizationFieldId = await findOrganizationFieldId();
  const fieldsToRequest = ['summary', 'description', 'created', 'updated', 'status', 'assignee', 'project'];
  if (organizationFieldId) fieldsToRequest.push(organizationFieldId);

  const issues = await loadAllIssues(searchJql, fieldsToRequest, 25);

  return {
    total: issues.length,
    tickets: issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields?.summary ?? '',
      description: descriptionExcerpt(issue.fields?.description),
      created: issue.fields?.created ?? null,
      updated: issue.fields?.updated ?? null,
      status: issue.fields?.status?.name ?? '',
      category: issue.fields?.status?.statusCategory?.key ?? '',
      assignee: issue.fields?.assignee?.displayName ?? 'Unassigned',
      project: issue.fields?.project?.key ?? '-',
      organization: organizationFieldId ? toNames(issue.fields?.[organizationFieldId]) : '-',
    })),
  };
});

export const handler = resolver.getDefinitions();
