import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as echarts from 'echarts';
import { invoke } from '@forge/bridge';
import {
  DEFAULT_JQL,
  buildSearchJql,
  buildHistoricalHistogramFromPreviousYear,
  buildStaticTimelineJql,
  formatJqlDate,
  getWindowForTimeframe,
  intervalOptions,
  shiftDateByYears,
  timeframeOptions,
  toTimeHistogram,
} from './time.js';
import { toVisibleIssuesWithNames } from './tickets.js';
import { levelFor, toAssigneeCounts } from './assignees.js';

const ROWS_PER_PAGE = 10;

function ChartPanel({ histogram, historicalHistogram, interval }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !histogram?.length) return;

    const chart = echarts.init(containerRef.current, null, { renderer: 'canvas' });

    chart.setOption({
      animation: false,
      title: {
        text: 'Tickets over time',
        subtext: 'green bar diagram = tickets of timeline chosen / gray bar diagram = tickets same time last year',
        textStyle: { fontSize: 13, fontWeight: 700, color: '#5e6c84' },
        subtextStyle: { fontSize: 12, color: '#42526e' },
      },
      grid: {
        top: 70,
        left: 42,
        right: 14,
        bottom: interval === 'hour' ? 72 : 46,
      },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: histogram.map((d) => d.period),
        axisLabel: {
          interval: interval === 'hour' ? 'auto' : 0,
          rotate: interval === 'hour' ? 45 : 0,
        },
      },
      yAxis: { type: 'value', name: 'Tickets', minInterval: 1 },
      series: [
        {
          name: 'Tickets (last year)',
          type: 'bar',
          data: (historicalHistogram ?? []).map((d) => d.tickets),
          barGap: '-100%',
          barWidth: '55%',
          itemStyle: { color: '#97A0AF' },
          z: 1,
          emphasis: { focus: 'series' },
        },
        {
          name: 'Tickets',
          type: 'bar',
          data: histogram.map((d) => d.tickets),
          barWidth: '55%',
          itemStyle: { color: 'rgba(168, 230, 207, 0.6)' },
          z: 2,
          emphasis: { focus: 'series' },
        },
      ],
      legend: { data: ['Tickets', 'Tickets (last year)'], bottom: 0 },
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [histogram, historicalHistogram, interval]);

  return <div ref={containerRef} className="chart" />;
}

function App() {
  const [timeframeDays, setTimeframeDays] = useState(28);
  const [jqlInput, setJqlInput] = useState(DEFAULT_JQL);
  const [appliedJql, setAppliedJql] = useState(DEFAULT_JQL);
  const [interval, setInterval] = useState('day');
  const [tablePage, setTablePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const hasLoadedOnceRef = useRef(false);
  const availableIntervalOptions = useMemo(
    () => (timeframeDays === 7 ? intervalOptions.filter((option) => option.value !== 'week') : intervalOptions),
    [timeframeDays]
  );

  useEffect(() => {
    let mounted = true;

    async function loadHistogram() {
      if (!hasLoadedOnceRef.current) setLoading(true);
      else setIsUpdating(true);

      setError('');

      try {
        const window = getWindowForTimeframe(timeframeDays);
        const searchJql = buildSearchJql(appliedJql);

        const historicalWindow = {
          start: shiftDateByYears(window.start, -1),
          end: shiftDateByYears(window.end, -1),
        };

        const { issues = [], historicalIssues = [], visibleIssues = [], namesMap = {} } = await invoke('loadGadgetData', {
          searchJql,
          historicalJql: buildStaticTimelineJql(searchJql, historicalWindow),
          windowStart: formatJqlDate(window.start),
          windowEnd: formatJqlDate(window.end),
        });

        const histogram = toTimeHistogram(issues, interval, window);
        const historical = buildHistoricalHistogramFromPreviousYear(historicalIssues, interval, window);
        const tickets = toVisibleIssuesWithNames(visibleIssues, window, namesMap);
        const total = histogram.reduce((sum, bucket) => sum + bucket.tickets, 0);

        if (!mounted) return;
        setData({
          total,
          histogram,
          historicalHistogram: historical.histogram,
          historicalIssueCount: historicalIssues.length,
          tickets,
          assignees: toAssigneeCounts(issues),
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
  }, [timeframeDays, interval, appliedJql]);

  const totalTickets = data?.tickets?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTickets / ROWS_PER_PAGE));
  const safePage = Math.min(tablePage, totalPages);
  const pageStart = (safePage - 1) * ROWS_PER_PAGE;
  const pageEnd = pageStart + ROWS_PER_PAGE;
  const pagedTickets = (data?.tickets ?? []).slice(pageStart, pageEnd);

  useEffect(() => {
    setTablePage(1);
  }, [appliedJql, timeframeDays, interval]);

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
              value={timeframeDays}
              disabled={isUpdating}
              onChange={(event) => {
                const nextDays = Number(event.target.value);
                setTimeframeDays(nextDays);
                if (nextDays === 7 && interval === 'week') setInterval('day');
              }}
            >
              {timeframeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="block">
            <label htmlFor="bucket">Bar-size</label>
            <select id="bucket" value={interval} disabled={isUpdating} onChange={(event) => setInterval(event.target.value)}>
              {availableIntervalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="small">Total issues: {data?.total ?? 0}</div>
      </div>

      <div className="panel">
        {data?.histogram?.length ? (
          <>
            <ChartPanel histogram={data.histogram} historicalHistogram={data.historicalHistogram} interval={interval} />
            <div className="small">Gray bars show the same timeframe from one year earlier, using the same JQL. | Historical rows: {data.historicalIssueCount}</div>
          </>
        ) : (
          <div className="small">No issues were found for the selected timeframe and bucket settings.</div>
        )}
      </div>

      <div className="panel">
        <div className="meta section-heading"><strong>Tickets per Assignee</strong></div>
        {data?.assignees?.length ? (
          <div className="assignee-grid">
            {data.assignees.map((entry) => (
              <div key={entry.key} className={`assignee-card ${levelFor(entry.count, entry.unassigned)}`}>
                <div className="name" title={entry.label}>{entry.label}</div>
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
