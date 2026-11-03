import React, { useMemo } from 'react';
import { buildYearComparison } from './yearComparison.js';

// Black arrow and the difference: more tickets than last year = up, fewer = down, equal = a dash.
function change(row) {
  const difference = row.current - row.last;
  if (difference > 0) return `▲ +${difference}`;
  if (difference < 0) return `▼ −${Math.abs(difference)}`;
  return '–';
}

// One half of the table. offset = position of its first row in the full list (to find the group of a row).
function YearTable({ report, rows, offset, groups, colorFor, hovered, setHovered, total }) {
  return (
    <table className="queue-table yc-table">
      <thead>
        <tr>
          <th>Group</th>
          <th className="yc-num">All time</th>
          <th className="yc-num">{report.lastYear}</th>
          <th className="yc-num">{report.thisYear}</th>
          <th className="yc-change" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const group = groups[offset + index];
          return (
            <tr
              key={row.label}
              className={hovered === row.label ? 'on' : ''}
              onMouseEnter={() => setHovered(row.label)}
              onMouseLeave={() => setHovered(null)}
            >
              <td>
                <span className="swatch" style={{ background: colorFor(group) }} />
                {row.label}
              </td>
              <td className="yc-num yc-all">{group.count}</td>
              <td className={`yc-num${row.last > row.current ? ' yc-bigger' : ''}`}>{row.last}</td>
              <td className={`yc-num${row.current > row.last ? ' yc-bigger' : ''}`}>{row.current}</td>
              <td className="yc-change">{change(row)}</td>
            </tr>
          );
        })}
      </tbody>
      {total ? (
        <tfoot>
          <tr className="yc-total">
            <th>Total</th>
            <td className="yc-num">{total.all}</td>
            <td className="yc-num">{total.last}</td>
            <td className="yc-num">{total.current}</td>
            <td className="yc-change" />
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

// All groups below the diagram: the all-time number and the two years next to each other, in two tables side by side.
// colorFor(group) gives the swatch color; hovered / setHovered link the rows to the bubbles.
export default function YearComparison({ tickets, groups, colorFor, hovered, setHovered }) {
  const report = useMemo(() => buildYearComparison(tickets, groups), [tickets, groups]);
  if (!groups.length) return null;

  const half = Math.ceil(report.rows.length / 2);
  const left = report.rows.slice(0, half);
  const right = report.rows.slice(half);
  const total = { ...report.total, all: groups.reduce((sum, group) => sum + group.count, 0) };

  return (
    <div className="yc-split">
      <YearTable
        report={report}
        rows={left}
        offset={0}
        groups={groups}
        colorFor={colorFor}
        hovered={hovered}
        setHovered={setHovered}
      />
      <YearTable
        report={report}
        rows={right}
        offset={half}
        groups={groups}
        colorFor={colorFor}
        hovered={hovered}
        setHovered={setHovered}
        total={total}
      />
    </div>
  );
}
