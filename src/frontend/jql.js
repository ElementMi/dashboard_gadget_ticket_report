// Default: all incidents of one organization, all time.
export const DEFAULT_JQL =
  'project IN (SUP, ESUP) AND organizations = "ELSINGHORST Stahl" AND issuetype = Incident ORDER BY created DESC';

export function buildSearchJql(userJql) {
  const trimmed = (userJql ?? '').trim();
  if (!trimmed) return DEFAULT_JQL;
  if (/\border\s+by\b/i.test(trimmed)) return trimmed;
  return `${trimmed} ORDER BY created DESC`;
}
