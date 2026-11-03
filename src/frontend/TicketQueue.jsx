import React, { useEffect, useMemo, useState } from 'react';
import { router } from '@forge/bridge';
import { PAGE_SIZE, STATUS_COLUMNS, buildReport, paginate } from './groupStatusReport.js';
import { ageInDays } from './statuses.js';

function formatOpenFor(created) {
  const days = ageInDays(created);
  if (days === null) return '-';
  const wholeDays = Math.floor(days);
  const hours = Math.floor((days - wholeDays) * 24);
  return wholeDays > 0 ? `${wholeDays}d ${hours}h` : `${hours}h`;
}

// The YouTrack tickets of the organization, below the totals: one row per YouTrack project with the status counts
// and the open tickets under it, in the same columns as the Jira groups above.
function SumRow({ label, counts, total, className }) {
  return (
    <tr className={className}>
      <th>{label}</th>
      {counts.map((count, index) => (
        <td key={STATUS_COLUMNS[index]} className="gs-num">
          {count}
        </td>
      ))}
      <td />
      <td />
      <td className="gs-num">{total}</td>
    </tr>
  );
}

function YoutrackRows({ youtrack, jiraAll }) {
  if (!youtrack) return null;
  const span = STATUS_COLUMNS.length + 4;

  if (!youtrack.available) {
    return (
      <tr className="gs-rest-row">
        <td colSpan={span}>YouTrack tickets are not available ({youtrack.reason ?? 'not connected'}).</td>
      </tr>
    );
  }

  // Sum over all YouTrack projects shown here.
  const youtrackAll = { counts: STATUS_COLUMNS.map(() => 0), total: 0 };
  for (const project of youtrack.projects) {
    project.counts.forEach((count, index) => (youtrackAll.counts[index] += count));
    youtrackAll.total += project.total;
  }

  return (
    <>
      <tr className="gs-section-row">
        <th colSpan={span}>YouTrack</th>
      </tr>
      {youtrack.projects.map((project) => {
        const open = [...project.open].sort(
          (a, b) => a.column - b.column || (ageInDays(b.created) ?? 0) - (ageInDays(a.created) ?? 0)
        );
        return (
          <React.Fragment key={project.project}>
            <tr className="gs-group">
              <th>
                {project.project} - {project.name}
              </th>
              {project.counts.map((count, index) => (
                <td key={STATUS_COLUMNS[index]} className="gs-num">
                  {count}
                </td>
              ))}
              <td />
              <td />
              <td className="gs-num">{project.total}</td>
            </tr>
            {open.map((ticket) => (
              <tr key={ticket.key} className="gs-detail">
                <td>
                  <div className="gs-key-grid">
                    <span>
                      <a
                        href={`${youtrack.baseUrl}/issue/${ticket.key}`}
                        onClick={(event) => {
                          event.preventDefault();
                          router.open(`${youtrack.baseUrl}/issue/${ticket.key}`);
                        }}
                      >
                        {ticket.key}
                      </a>
                    </span>
                    <span>{project.project}</span>
                    <span>{ticket.assignee}</span>
                    <span>{ticket.summary}</span>
                  </div>
                </td>
                <td colSpan={STATUS_COLUMNS.length} />
                <td>{project.name}</td>
                <td>{formatOpenFor(ticket.created)}</td>
                <td />
              </tr>
            ))}
          </React.Fragment>
        );
      })}
      <SumRow label="All YouTrack tickets" counts={youtrackAll.counts} total={youtrackAll.total} className="gs-total-row" />
      {jiraAll ? (
        <SumRow
          label="All tickets (Jira + YouTrack)"
          counts={jiraAll.counts.map((count, index) => count + youtrackAll.counts[index])}
          total={jiraAll.total + youtrackAll.total}
          className="gs-grand-row"
        />
      ) : null}
    </>
  );
}

// Column order of the table: Group (and, in the ticket rows, Key / Project / Assignee / Summary), the five status
// columns, Organization, Open for, Total. The columns have fixed widths so group rows and ticket rows line up.
export default function TicketQueue({ tickets, groups, youtrack, printAll = false }) {
  const [page, setPage] = useState(1);
  const report = useMemo(() => buildReport(tickets, groups), [tickets, groups]);
  const pages = useMemo(() => paginate(report.rows, PAGE_SIZE), [report]);

  useEffect(() => {
    setPage(1);
  }, [tickets]);

  const totalPages = Math.max(1, pages.length);
  const safePage = Math.min(page, totalPages);
  // For the printout all pages are shown at once.
  const blocks = printAll ? pages.flat() : pages[safePage - 1] ?? [];

  const before = pages.slice(0, safePage - 1).reduce((sum, p) => sum + p.reduce((s, b) => s + b.items.length, 0), 0);
  const onPage = blocks.reduce((sum, block) => sum + block.items.length, 0);
  const columnCount = STATUS_COLUMNS.length + 4;

  const emptyStatusCells = <td colSpan={STATUS_COLUMNS.length} />;

  return (
    <>
      <div className="section-heading">Open tickets by group and status</div>
      <div className="queue-pager-row no-print">
        <div className="small">
          Showing {onPage ? before + 1 : 0}-{before + onPage} of {report.totals.open} open tickets in {report.rows.length} groups
        </div>
        <div className="pager-actions">
          <button disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
            Previous {PAGE_SIZE}
          </button>
          <span className="small">
            Page {safePage} / {totalPages}
          </span>
          <button disabled={safePage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
            Next {PAGE_SIZE}
          </button>
        </div>
      </div>

      <div className="queue-wrap">
        <table className="queue-table gs-table">
          <colgroup>
            <col />
            {STATUS_COLUMNS.map((column) => (
              <col key={column} className="gs-col-status" />
            ))}
            <col className="gs-col-org" />
            <col className="gs-col-open" />
            <col className="gs-col-total" />
          </colgroup>
          <thead>
            <tr>
              <th>Group</th>
              {STATUS_COLUMNS.map((column) => (
                <th key={column} className="gs-num">
                  {column}
                </th>
              ))}
              <th>Organization</th>
              <th>Open for</th>
              <th className="gs-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {blocks.length ? (
              blocks.map((block) => (
                <React.Fragment key={`${block.row.label}-${block.continued ? 'c' : 'a'}`}>
                  <tr className="gs-group">
                    <th>
                      {block.row.label}
                      {block.continued ? ' (continued)' : ''}
                    </th>
                    {block.row.counts.map((count, index) => (
                      <td key={STATUS_COLUMNS[index]} className="gs-num">
                        {count}
                      </td>
                    ))}
                    <td />
                    <td />
                    <td className="gs-num">{block.row.total}</td>
                  </tr>
                  <tr className="gs-detail-head">
                    <td>
                      <div className="gs-key-grid">
                        <span>Key</span>
                        <span>Project</span>
                        <span>Assignee</span>
                        <span>Summary</span>
                      </div>
                    </td>
                    {emptyStatusCells}
                    <td>Organization</td>
                    <td>Open for</td>
                    <td />
                  </tr>
                  {block.items.map(({ ticket }) => (
                    <tr key={ticket.key} className="gs-detail">
                      <td>
                        <div className="gs-key-grid">
                          <span>
                            <a
                              href={`/browse/${ticket.key}`}
                              onClick={(event) => {
                                event.preventDefault();
                                router.open(`/browse/${ticket.key}`);
                              }}
                            >
                              {ticket.key}
                            </a>
                          </span>
                          <span>{ticket.project}</span>
                          <span>{ticket.assignee}</span>
                          <span>{ticket.summary}</span>
                        </div>
                      </td>
                      {emptyStatusCells}
                      <td>{ticket.organization}</td>
                      <td>{formatOpenFor(ticket.created)}</td>
                      <td />
                    </tr>
                  ))}
                </React.Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={columnCount} className="small">
                  No open tickets for the current JQL.
                </td>
              </tr>
            )}
          </tbody>
          {report.rows.length || youtrack ? (
            <tfoot>
              {report.rows.length ? (
                <>
              <tr className="gs-total-row">
                <th>Total (listed groups)</th>
                {report.totals.counts.map((count, index) => (
                  <td key={STATUS_COLUMNS[index]} className="gs-num">
                    {count}
                  </td>
                ))}
                <td />
                <td />
                <td className="gs-num">{report.totals.total}</td>
              </tr>
              <tr className="gs-rest-row">
                <th>Groups without open tickets ({report.rest.groups})</th>
                {report.rest.counts.map((count, index) => (
                  <td key={STATUS_COLUMNS[index]} className="gs-num">
                    {count}
                  </td>
                ))}
                <td />
                <td />
                <td className="gs-num">{report.rest.total}</td>
              </tr>
              <tr className="gs-total-row">
                <th>All tickets (as in the diagram)</th>
                {report.all.counts.map((count, index) => (
                  <td key={STATUS_COLUMNS[index]} className="gs-num">
                    {count}
                  </td>
                ))}
                <td />
                <td />
                <td className="gs-num">{report.all.total}</td>
              </tr>
                </>
              ) : null}
              {safePage === totalPages || printAll ? <YoutrackRows youtrack={youtrack} jiraAll={report.all} /> : null}
            </tfoot>
          ) : null}
        </table>
      </div>
    </>
  );
}
