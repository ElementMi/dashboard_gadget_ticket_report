import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import { DEFAULT_JQL, buildSearchJql } from './jql.js';
import { groupTickets, pastelFor } from './groups.js';
import { layoutBubbles } from './pack.js';
import TicketQueue from './TicketQueue.jsx';
import YearComparison from './YearComparison.jsx';
import { youtrackProjectsFor } from './youtrackProjects.js';

const CHART_MIN_HEIGHT = 300;
const CHART_MAX_HEIGHT = 608;
const OTHER_FILL = '#E3E6ED';
const AUTOMATIC_FILL = '#97A0AF'; // groups that are not predefined (found automatically), gray
const BUILD_STAMP = 'build 03.11. 15:04';

// Predefined groups: a pastel color of their own. Groups found automatically: gray. "Other": light gray.
function bubbleStyle(group) {
  if (group.other) return { fill: OTHER_FILL, text: '#172B4D' };
  const pastel = group.fixed ? pastelFor(group.label) : null;
  return { fill: pastel ?? AUTOMATIC_FILL, text: '#172B4D' };
}

// below(hovered, setHovered): what is shown under the bubbles (the table of all groups with all-time and yearly numbers).
function BubbleChart({ groups, below = null }) {
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

  const height = Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, Math.round(width * 0.39)));
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
                    fontSize={Math.min(40, Math.max(11, bubble.r * 0.8))}
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
      </div>
      {below ? below(hovered, setHovered) : null}
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
  const [youtrack, setYoutrack] = useState(null);
  const [printAll, setPrintAll] = useState(false);
  const [printHint, setPrintHint] = useState('');
  const hasLoadedOnceRef = useRef(false);

  // For the printout the table shows all its pages at once; afterwards it goes back to 50 per page.
  useEffect(() => {
    const done = () => setPrintAll(false);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);

  function handlePrint() {
    setPrintHint('');
    setPrintAll(true);
    // Give the page a moment to draw all rows before the print dialog opens.
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        setPrintAll(false);
        setPrintHint('Printing is blocked here. Open the gadget in full screen and press Ctrl+P.');
      }
    }, 300);
  }

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

        // The YouTrack tickets of the same organization load on their own: if YouTrack is slow or not connected,
        // the Jira part above is not affected.
        const youtrackProjects = youtrackProjectsFor(tickets);
        if (youtrackProjects.length) {
          invoke('loadYoutrackReport', { projects: youtrackProjects })
            .then((result) => mounted && setYoutrack(result))
            .catch(() => mounted && setYoutrack({ available: false, reason: 'error' }));
        } else {
          setYoutrack(null);
        }
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
              <button className="no-print" onClick={handlePrint}>
                Print
              </button>
              <span className="small found">
                Tickets found: {data?.total ?? 0} · {BUILD_STAMP}
              </span>
            </div>
            {printHint ? <div className="small no-print">{printHint}</div> : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <BubbleChart
          groups={data?.groups ?? []}
          below={(hovered, setHovered) => (
            <YearComparison
              tickets={data?.tickets ?? []}
              groups={data?.groups ?? []}
              colorFor={(group) => bubbleStyle(group).fill}
              hovered={hovered}
              setHovered={setHovered}
            />
          )}
        />
      </div>

      <div className="panel print-new-page">
        <TicketQueue tickets={data?.tickets ?? []} groups={data?.groups ?? []} youtrack={youtrack} printAll={printAll} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
