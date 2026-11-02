import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, router } from '@forge/bridge';
import { DEFAULT_JQL, buildSearchJql } from './jql.js';
import { groupTickets } from './groups.js';
import { layoutBubbles } from './pack.js';
import { STATUS_GROUP_DETAILS, ageInDays, buildAgeStatusTable, parseJiraDate, statusGroupFor } from './statuses.js';
import { BAR_NORMAL, BAR_REVERSED, rampColor, textColorOn } from './colors.js';

const CHART_MIN_HEIGHT = 300;
const CHART_MAX_HEIGHT = 460;
const HEAT = [179, 38, 30]; // #B3261E
const OTHER_FILL = '#E3E6ED';

// Darker red for more tickets, relative to the biggest group.
function bubbleStyle(group, max) {
  if (group.other) return { fill: OTHER_FILL, text: '#172B4D' };
  const share = 0.18 + 0.82 * Math.pow(group.count / max, 0.8);
  const rgb = HEAT.map((channel) => Math.round(255 + (channel - 255) * share));
  return { fill: `rgb(${rgb.join(',')})`, text: share >= 0.62 ? '#FFFFFF' : '#172B4D' };
}

function BubbleChart({ groups }) {
  const [hovered, setHovered] = useState(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(560);
  const hasGroups = groups.length > 0;

  // The picture takes all the room next to the list and follows the width of the gadget.
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let timer = null;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width / 20) * 20;
      if (measured >= 240) setWidth(measured);
    };
    // Wait a moment while the window is being dragged, so the layout is not recalculated on every pixel.
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 150);
    };
    measure();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [hasGroups]);

  const height = Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, Math.round(width * 0.58)));
  const bubbles = useMemo(() => layoutBubbles(groups, width, height), [groups, width, height]);
  const max = groups.length ? groups[0].count : 1;
  const total = groups.reduce((sum, g) => sum + g.count, 0);

  if (!groups.length) {
    return <div className="small">No tickets for the current JQL.</div>;
  }

  return (
    <>
      <div className="head">
        <div className="eyebrow">All tickets</div>
        <div className="big">
          {total} <span className="big-note">tickets in {groups.length} groups</span>
        </div>
      </div>
      <div className="chart-body">
        <div className="chart-wrap" ref={wrapRef}>
        <svg
          className="bubbles"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Bubble chart of tickets grouped by topic"
        >
          {bubbles.map((bubble) => {
            const style = bubbleStyle(bubble, max);
            const isHovered = hovered === bubble.label;
            return (
              <g
                key={bubble.label}
                onMouseEnter={() => setHovered(bubble.label)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${bubble.label}: ${bubble.count} tickets`}</title>
                <circle
                  cx={bubble.cx}
                  cy={bubble.cy}
                  r={bubble.r}
                  fill={style.fill}
                  stroke={isHovered ? '#172B4D' : '#FFFFFF'}
                  strokeWidth={isHovered ? 3 : 2}
                />
                {bubble.r >= 11 && (
                  <text
                    x={bubble.cx}
                    y={bubble.cy}
                    fill={style.text}
                    fontSize={Math.min(22, Math.max(11, bubble.r * 0.8))}
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                  >
                    {bubble.count}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        </div>
        <ol className="ranking">
          {groups.map((group) => {
            const style = bubbleStyle(group, max);
            return (
              <li
                key={group.label}
                className={hovered === group.label ? 'on' : ''}
                onMouseEnter={() => setHovered(group.label)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="swatch" style={{ background: style.fill }} />
                <span className="rank-label">{group.label}</span>
                <span className="rank-count">{group.count}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

// Cell colour from the shared purple-to-cream scale. Open-work columns: many tickets = light (like "busy" in the
// weekday heatmap). Reversed columns (waiting, solved): many tickets = dark.
function cellStyle(count, max, reversed) {
  const share = Math.min(1, count / max);
  const rgb = rampColor(reversed ? 1 - share : share);
  return { background: `rgb(${rgb.join(',')})`, color: textColorOn(rgb) };
}

function tickValues(max) {
  return [0, 1, 2, 3, 4].map((step) => Math.round(((max * (4 - step)) / 4) * 10) / 10);
}

function ScaleBar({ title, max, reversed, height }) {
  return (
    <div className="scale-col">
      <div className="scale-body" style={{ height }}>
        <div className="scale-gradient" style={{ background: reversed ? BAR_REVERSED : BAR_NORMAL }} />
        <div className="scale-ticks">
          {tickValues(max).map((value, index) => (
            <span key={index}>{value}</span>
          ))}
        </div>
      </div>
      <div className="scale-title">{title}</div>
    </div>
  );
}

function AgeStatusHeatmap({ tickets }) {
  const table = useMemo(() => buildAgeStatusTable(tickets), [tickets]);
  const barHeight = table.rows.length * 34;

  return (
    <>
      <div className="heat-title">Tickets by age and status</div>
      <div className="heat-desc">
        How old the tickets are and where they stand now. {table.total} tickets. Dark purple is quiet, cream is busy.
        For Waiting for customer and Solved / closed the scale is reversed: dark purple is busy.
      </div>
      <div className="heat-layout">
        <div className="table-scroll">
          <table className="age-table">
            <thead>
              <tr>
                <th className="corner" />
                {table.columns.map((column) => (
                  <th key={column.label}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.label}>
                  <th className="row-label">{row.label}</th>
                  {row.cells.map((count, index) => {
                    const column = table.columns[index];
                    const max = column.reversed ? table.maxReversed : table.maxOpenWork;
                    return (
                      <td key={column.label}>
                        <div
                          className="age-cell"
                          style={cellStyle(count, max, column.reversed)}
                          title={`${row.label}, ${column.label}: ${count} tickets`}
                        >
                          {count}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="scales">
          <ScaleBar title="Open work" max={table.maxOpenWork} reversed={false} height={barHeight} />
          <ScaleBar title="Waiting and solved (reversed)" max={table.maxReversed} reversed height={barHeight} />
        </div>
        <StatusLegend />
      </div>
    </>
  );
}

function StatusLegend() {
  return (
    <div className="legend-block">
      <div className="heat-title">How the statuses are grouped</div>
      <div className="heat-desc">
        SUP and ESUP name the same step differently, so each status is sorted into one of these columns. The German
        names (Gelöst, Geschlossen) are the same statuses. A status that is not listed here goes by its Jira category.
      </div>
      <div className="table-scroll">
        <table className="legend-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>SUP</th>
              <th>ESUP</th>
            </tr>
          </thead>
          <tbody>
            {STATUS_GROUP_DETAILS.map((group) => (
              <tr key={group.label}>
                <th scope="row">{group.label}</th>
                <td>{group.sup.length ? group.sup.join(', ') : '-'}</td>
                <td>{group.esup.length ? group.esup.join(', ') : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ROWS_PER_PAGE = 10;
const berlinFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatBerlin(value) {
  if (!value) return '-';
  const date = parseJiraDate(value);
  return Number.isNaN(date.getTime()) ? '-' : berlinFormatter.format(date);
}

function formatOpenFor(created) {
  const days = ageInDays(created);
  if (days === null) return '-';
  const wholeDays = Math.floor(days);
  const hours = Math.floor((days - wholeDays) * 24);
  return wholeDays > 0 ? `${wholeDays}d ${hours}h` : `${hours}h`;
}

// The ticket queue from the CFG gadget: only tickets that are not solved or closed, ten per page.
function TicketQueue({ tickets }) {
  const [page, setPage] = useState(1);
  const queue = useMemo(
    () => tickets.filter((ticket) => statusGroupFor(ticket.status, ticket.category) !== 'Solved / closed'),
    [tickets]
  );

  useEffect(() => {
    setPage(1);
  }, [tickets]);

  const totalPages = Math.max(1, Math.ceil(queue.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * ROWS_PER_PAGE;
  const end = start + ROWS_PER_PAGE;
  const rows = queue.slice(start, end);

  return (
    <>
      <div className="section-heading">Ticket queue (not closed)</div>
      <div className="queue-pager-row">
        <div className="small">
          Showing {queue.length ? start + 1 : 0}-{Math.min(end, queue.length)} of {queue.length}
        </div>
        <div className="pager-actions">
          <button disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
            Previous 10
          </button>
          <span className="small">
            Page {safePage} / {totalPages}
          </span>
          <button disabled={safePage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
            Next 10
          </button>
        </div>
      </div>
      <div className="queue-wrap">
        <table className="queue-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Project</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Summary</th>
              <th>Organization</th>
              <th>Created (Berlin)</th>
              <th>Updated (Berlin)</th>
              <th>Open for</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((ticket) => (
                <tr key={ticket.key}>
                  <td>
                    <a
                      href={`/browse/${ticket.key}`}
                      onClick={(event) => {
                        event.preventDefault();
                        router.open(`/browse/${ticket.key}`);
                      }}
                    >
                      {ticket.key}
                    </a>
                  </td>
                  <td>{ticket.project}</td>
                  <td>{ticket.status}</td>
                  <td>{ticket.assignee}</td>
                  <td>{ticket.summary}</td>
                  <td>{ticket.organization}</td>
                  <td>{formatBerlin(ticket.created)}</td>
                  <td>{formatBerlin(ticket.updated)}</td>
                  <td>{formatOpenFor(ticket.created)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="small">
                  No open tickets for the current JQL.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function App() {
  const [jqlInput, setJqlInput] = useState(DEFAULT_JQL);
  const [appliedJql, setAppliedJql] = useState(DEFAULT_JQL);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function loadReport() {
      if (!hasLoadedOnceRef.current) setLoading(true);
      else setIsUpdating(true);

      setError('');

      try {
        const { total = 0, tickets = [] } = await invoke('loadReportData', {
          searchJql: buildSearchJql(appliedJql),
        });

        if (!mounted) return;
        setData({ total, tickets, groups: groupTickets(tickets) });
      } catch (e) {
        if (!mounted) return;
        setError(e?.message ?? 'Unexpected error while loading gadget data.');
        setData(null);
      } finally {
        if (mounted && !hasLoadedOnceRef.current) {
          setLoading(false);
          hasLoadedOnceRef.current = true;
        }

        if (mounted) {
          setIsUpdating(false);
        }
      }
    }

    loadReport();
    return () => {
      mounted = false;
    };
  }, [appliedJql]);

  if (loading) {
    return <div className="shell">Loading ticket data from Jira...</div>;
  }

  if (error) {
    return (
      <div className="shell">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="panel">
        <div className="row">
          <div className="block jql-block">
            <label htmlFor="jql-filter">JQL statement</label>
            <div className="jql-row">
              <textarea
                id="jql-filter"
                value={jqlInput}
                placeholder={DEFAULT_JQL}
                onChange={(event) => setJqlInput(event.target.value)}
                readOnly={isUpdating}
              />
              <button disabled={isUpdating} onClick={() => setAppliedJql(jqlInput)}>
                Apply
              </button>
            </div>
          </div>
        </div>

        <div className="small">Tickets found: {data?.total ?? 0}</div>
      </div>

      <div className="panel">
        <BubbleChart groups={data?.groups ?? []} />
      </div>

      <div className="panel">
        <AgeStatusHeatmap tickets={data?.tickets ?? []} />
      </div>

      <div className="panel">
        <TicketQueue tickets={data?.tickets ?? []} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
