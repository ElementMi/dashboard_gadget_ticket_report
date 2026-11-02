import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

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

resolver.define('loadReportData', async ({ payload }) => {
  const searchJql = payload?.searchJql;

  if (!searchJql) {
    throw new Error('Missing search JQL.');
  }

  const organizationFieldId = await findOrganizationFieldId();
  const fieldsToRequest = ['summary', 'created', 'updated', 'status', 'assignee', 'project'];
  if (organizationFieldId) fieldsToRequest.push(organizationFieldId);

  const issues = await loadAllIssues(searchJql, fieldsToRequest, 25);

  return {
    total: issues.length,
    tickets: issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields?.summary ?? '',
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
