import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import { DEFAULT_JQL, buildSearchJql } from './jql.js';
import { groupTickets } from './groups.js';
import { layoutBubbles } from './pack.js';
import TicketQueue from './TicketQueue.jsx';

const CHART_MIN_HEIGHT = 300;
const CHART_MAX_HEIGHT = 460;
const HEAT = [179, 38, 30]; // #B3261E
const OTHER_FILL = '#E3E6ED';
const FIXED_FILL = '#97A0AF'; // fixed (hard-coded) groups, gray for now
const BLUE_FILL = '#8AB4E8'; // groups sorted by process step
const BUILD_STAMP = 'build 03.11. 12:33';

// Darker red for more tickets, relative to the biggest group.
function bubbleStyle(group, max) {
  if (group.other) return { fill: OTHER_FILL, text: '#172B4D' };
  if (group.blue) return { fill: BLUE_FILL, text: '#172B4D' };
  if (group.fixed) return { fill: FIXED_FILL, text: '#172B4D' };
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

        <div className="small">Tickets found: {data?.total ?? 0} · {BUILD_STAMP}</div>
      </div>

      <div className="panel">
        <BubbleChart groups={data?.groups ?? []} />
      </div>

      <div className="panel">
        <TicketQueue tickets={data?.tickets ?? []} groups={data?.groups ?? []} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
