import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as echarts from 'echarts';
import { invoke } from '@forge/bridge';
import {
  DEFAULT_JQL,
  buildSearchJql,
  formatJqlDate,
  getWindowForTimeframe,
  timeframeOptions,
  toTimeHistogram,
} from './time.js';
import { toVisibleIssuesWithNames } from './tickets.js';
import {
  TOTAL_LINE_COLOR,
  UNASSIGNED_LINE_COLOR,
  levelFor,
  lineColorForRank,
  toAssigneeCounts,
} from './assignees.js';

const ROWS_PER_PAGE = 10;

// Stretched y axis: 0-10 tickets at 6x size, 10-30 at 3x, 30-60 at half, above 60 at a quarter.
const Y_SEGMENTS = [
  { from: 0, to: 10, weight: 6 },
  { from: 10, to: 30, weight: 3 },
  { from: 30, to: 60, weight: 0.5 },
  { from: 60, to: Infinity, weight: 0.25 },
];
const Y_TICKS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 300];

function stretchY(value) {
  let position = 0;
  for (const segment of Y_SEGMENTS) {
    if (value <= segment.from) break;
    position += (Math.min(value, segment.to) - segment.from) * segment.weight;
  }
  return position;
}

// Ticks up to and including the first one above the highest value.
function pickYTicks(maxValue) {
  const ticks = [];
  for (const tick of Y_TICKS) {
    ticks.push(tick);
    if (tick >= maxValue) return ticks;
  }
  return [...ticks, Math.ceil(maxValue / 100) * 100];
}

function ChartPanel({ histogram, lines }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !histogram?.length) return;

    const chart = echarts.init(containerRef.current, null, { renderer: 'canvas' });

    const maxValue = Math.max(1, ...lines.flatMap((line) => line.values.filter((v) => v != null)));
    const yTicks = pickYTicks(maxValue);
    const labelFor = (position) => yTicks.find((tick) => Math.abs(stretchY(tick) - position) < 1e-6) ?? '';

    chart.setOption({
      animation: false,
      title: {
        text: 'Open tickets per person',
        subtext: 'one line per assignee = open tickets at the end of each day / red line = all tickets combined / y axis: low numbers stretched, high numbers compressed',
        textStyle: { fontSize: 13, fontWeight: 700, color: '#5e6c84' },
        subtextStyle: { fontSize: 12, color: '#42526e' },
      },
      grid: {
        top: 70,
        left: 42,
        right: 14,
        bottom: 60,
      },
      // The points carry their real ticket count; the stretched position is only for drawing.
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const rows = params
            .filter((p) => p.data?.real != null)
            .sort((a, b) => b.data.real - a.data.real)
            .map((p) => `${p.marker} ${p.seriesName}: <b>${p.data.real}</b>`);
          return [params[0]?.axisValue, ...rows].join('<br/>');
        },
      },
      xAxis: {
        type: 'category',
        data: histogram.map((d) => d.period),
        axisLabel: {
          interval: 0,
          // Saturday and Sunday labels are bold.
          formatter: (value, index) => (histogram[index]?.isWeekend ? `{weekend|${value}}` : value),
          rich: { weekend: { fontWeight: 'bold', color: '#172b4d' } },
        },
      },
      yAxis: {
        type: 'value',
        name: 'Tickets',
        min: 0,
        max: stretchY(yTicks[yTicks.length - 1]),
        splitLine: { show: false },
        axisTick: { customValues: yTicks.map(stretchY) },
        axisLabel: {
          customValues: yTicks.map(stretchY),
          formatter: labelFor,
        },
      },
      series: [
        // Helper series that only draws the grid lines at the real tick positions.
        {
          type: 'line',
          data: [],
          silent: true,
          z: 0,
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: '#EBECF0', type: 'solid', width: 1 },
            data: yTicks.map((tick) => ({ yAxis: stretchY(tick) })),
          },
        },
        ...lines.map((line) => ({
          name: line.name,
          type: 'line',
          data: line.values.map((v) => (v == null ? null : { value: stretchY(v), real: v })),
          showSymbol: true,
          symbolSize: 7,
          lineStyle: { width: line.total ? 4 : 3, color: line.color },
          itemStyle: { color: line.color, borderColor: '#FFFFFF', borderWidth: 1 },
          z: line.total ? 10 : 2,
          emphasis: { focus: 'series', lineStyle: { width: line.total ? 5 : 4 } },
        })),
      ],
      legend: { data: lines.map((line) => line.name), bottom: 0, type: 'scroll' },
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [histogram, lines]);

  return <div ref={containerRef} className="chart" />;
}

function App() {
  const [timeframe, setTimeframe] = useState('month');
  const [jqlInput, setJqlInput] = useState(DEFAULT_JQL);
  const [appliedJql, setAppliedJql] = useState(DEFAULT_JQL);
  const [tablePage, setTablePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function loadHistogram() {
      if (!hasLoadedOnceRef.current) setLoading(true);
      else setIsUpdating(true);

      setError('');

      try {
        const window = getWindowForTimeframe(timeframe);
        const searchJql = buildSearchJql(appliedJql);

        const {
          issues = [],
          visibleIssues = [],
          namesMap = {},
          people = [],
          dailyCounts = [],
          todayKey = '',
        } = await invoke('loadGadgetData', {
          searchJql,
          windowStart: formatJqlDate(window.start),
          windowEnd: formatJqlDate(window.end),
        });

        const histogram = toTimeHistogram([], 'day', window);
        const tickets = toVisibleIssuesWithNames(visibleIssues, window, namesMap);

        // Past days come from the backend's daily counts, today from the open tickets, days after today stay empty.
        const countsByPersonDay = new Map(dailyCounts.map((c) => [`${c.accountId}|${c.day}`, c.count]));
        // Named people ranked by open tickets today, same order as the assignee boxes.
        const rankByAccountId = new Map(
          people
            .filter((p) => p.accountId)
            .sort((a, b) => b.openToday - a.openToday || a.displayName.localeCompare(b.displayName))
            .map((person, rank) => [person.accountId, rank])
        );
        const personLines = people
          .map((person) => ({
            key: person.accountId ?? 'Unassigned',
            name: person.displayName,
            unassigned: !person.accountId,
            count: person.openToday,
            color: person.accountId ? lineColorForRank(rankByAccountId.get(person.accountId)) : UNASSIGNED_LINE_COLOR,
            values: histogram.map((d) => {
              if (d.dayKey === todayKey) return person.openToday;
              if (d.dayKey > todayKey) return null;
              return countsByPersonDay.get(`${person.accountId}|${d.dayKey}`) ?? null;
            }),
          }))
          .sort((a, b) => Number(b.unassigned) - Number(a.unassigned) || b.count - a.count);

        const totalLine = {
          name: 'All tickets',
          total: true,
          color: TOTAL_LINE_COLOR,
          values: histogram.map((d, index) =>
            d.dayKey > todayKey ? null : personLines.reduce((sum, line) => sum + (line.values[index] ?? 0), 0)
          ),
        };
        const lines = [...personLines, totalLine];

        // The assignee boxes show each name in the colour of that person's line.
        const colorByKey = new Map(personLines.map((line) => [line.key, line.color]));
        const assignees = toAssigneeCounts(issues).map((entry) => ({ ...entry, color: colorByKey.get(entry.key) }));

        if (!mounted) return;
        setData({
          total: issues.length,
          histogram,
          lines,
          tickets,
          assignees,
        });
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

    loadHistogram();
    return () => {
      mounted = false;
    };
  }, [timeframe, appliedJql]);

  const totalTickets = data?.tickets?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTickets / ROWS_PER_PAGE));
  const safePage = Math.min(tablePage, totalPages);
  const pageStart = (safePage - 1) * ROWS_PER_PAGE;
  const pageEnd = pageStart + ROWS_PER_PAGE;
  const pagedTickets = (data?.tickets ?? []).slice(pageStart, pageEnd);

  useEffect(() => {
    setTablePage(1);
  }, [appliedJql, timeframe]);

  useEffect(() => {
    if (tablePage > totalPages) {
      setTablePage(totalPages);
    }
  }, [tablePage, totalPages]);

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
          <div className="block grow jql-block">
            <label htmlFor="jql-filter">Timeline [JQL]</label>
            <textarea
              id="jql-filter"
              value={jqlInput}
              placeholder={DEFAULT_JQL}
              onChange={(event) => setJqlInput(event.target.value)}
              readOnly={isUpdating}
            />
            <div>
              <button disabled={isUpdating} onClick={() => setAppliedJql(jqlInput)}>
                Apply
              </button>
            </div>
          </div>
        </div>

        <div className="row">
          <div className="block">
            <label htmlFor="timeline">Timeline</label>
            <select
              id="timeline"
              value={timeframe}
              disabled={isUpdating}
              onChange={(event) => setTimeframe(event.target.value)}
            >
              {timeframeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="small">Open issues: {data?.total ?? 0} | build 30.10. 11:26 UTC</div>
      </div>

      <div className="panel">
        {data?.histogram?.length ? (
          <>
            <ChartPanel histogram={data.histogram} lines={data.lines} />
          </>
        ) : (
          <div className="small">No issues were found for the selected timeframe.</div>
        )}
      </div>

      <div className="panel">
        <div className="meta section-heading"><strong>Tickets per Assignee</strong></div>
        {data?.assignees?.length ? (
          <div className="assignee-grid">
            {data.assignees.map((entry) => (
              <div key={entry.key} className={`assignee-card ${levelFor(entry.count, entry.unassigned)}`}>
                <div className="name" title={entry.label}>
                  <span className="name-chip" style={entry.color ? { background: entry.color } : undefined}>{entry.label}</span>
                </div>
                <div className="count">{entry.count}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="small">No tickets for the current JQL.</div>
        )}
      </div>

      <div className="panel">
        <div className="meta section-heading"><strong>Tickets Table</strong></div>
        <div className="row table-pager-row">
          <div className="small">
            Showing {totalTickets ? pageStart + 1 : 0}-{Math.min(pageEnd, totalTickets)} of {totalTickets}
          </div>
          <div className="pager-actions">
            <button disabled={safePage <= 1} onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}>Previous 10</button>
            <span className="small">Page {safePage} / {totalPages}</span>
            <button disabled={safePage >= totalPages} onClick={() => setTablePage((prev) => Math.min(totalPages, prev + 1))}>Next 10</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Project</th>
                <th>Impact</th>
                <th>Assignee</th>
                <th>Summary</th>
                <th>Organization</th>
                <th>Created (Berlin)</th>
                <th>Delta</th>
                <th>Updated (Berlin)</th>
                <th>Closed (Berlin)</th>
              </tr>
            </thead>
            <tbody>
              {pagedTickets.length ? (
                pagedTickets.map((ticket) => (
                  <tr key={ticket.key}>
                    <td><a href={`/browse/${ticket.key}`} target="_blank" rel="noreferrer">{ticket.key}</a></td>
                    <td>{ticket.project}</td>
                    <td>{ticket.impact}</td>
                    <td>{ticket.assignee}</td>
                    <td>{ticket.summary}</td>
                    <td>{ticket.organization}</td>
                    <td>{ticket.createdDisplay}</td>
                    <td>{ticket.deltaDisplay}</td>
                    <td>{ticket.updatedDisplay}</td>
                    <td>{ticket.closedDisplay}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="small">No tickets for the current filter and timeline.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
