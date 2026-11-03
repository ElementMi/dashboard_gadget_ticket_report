// Which YouTrack projects belong to which organization (the organization name as Jira shows it, in lower case).
// Add a line here for every organization whose YouTrack tickets should appear under the table.
const YOUTRACK_PROJECTS_BY_ORGANIZATION = {
  // ETGC is "Elsinghorst Technischer Grosshandel Collaboration", not Stahl: left out on purpose.
  'elsinghorst stahl': ['ESTH'],
};

// The YouTrack projects for the organizations that the loaded tickets belong to (empty = nothing to show).
export function youtrackProjectsFor(tickets) {
  const projects = new Set();
  for (const ticket of tickets) {
    const names = String(ticket.organization ?? '').split(',');
    for (const name of names) {
      for (const project of YOUTRACK_PROJECTS_BY_ORGANIZATION[name.trim().toLowerCase()] ?? []) projects.add(project);
    }
  }
  return [...projects];
}
