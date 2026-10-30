export const DEFAULT_JQL =
  'project = CFG AND status NOT IN (Closed, Resolved) ORDER BY created DESC, "impact (migrated 2)[dropdown]" ASC';

export const timeframeOptions = [
  { label: 'This month', value: 'month' },
  { label: 'This week', value: 'week' },
];

const BERLIN_TIMEZONE = 'Europe/Berlin';
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const dateOnlyFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
});
const hourOnlyFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function getTzParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday'),
  };
}

export function zonedDateTimeToUtcDate(parts, timeZone) {
  let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);

  // Iterate to resolve DST/offset differences between intended local wall-time and UTC timestamp.
  for (let i = 0; i < 4; i += 1) {
    const actual = getTzParts(new Date(timestamp), timeZone);
    const wantedUtcLike = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
    const actualUtcLike = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const diff = wantedUtcLike - actualUtcLike;
    timestamp += diff;

    if (diff === 0) {
      break;
    }
  }

  return new Date(timestamp);
}

export function getBerlinWeekWindow(now = new Date()) {
  const berlinNow = getTzParts(now, BERLIN_TIMEZONE);
  const weekday = weekdayMap[berlinNow.weekday] ?? 1;
  const minutesOfDay = berlinNow.hour * 60 + berlinNow.minute;

  // Before Monday 08:00, keep the previous reporting week active.
  let daysSinceMonday = weekday - 1;
  if (weekday === 1 && minutesOfDay < 8 * 60) {
    daysSinceMonday = 7;
  }

  const berlinDateOnlyUtc = Date.UTC(berlinNow.year, berlinNow.month - 1, berlinNow.day);
  const mondayDateOnly = new Date(berlinDateOnlyUtc - daysSinceMonday * MS_PER_DAY);

  const start = zonedDateTimeToUtcDate(
    {
      year: mondayDateOnly.getUTCFullYear(),
      month: mondayDateOnly.getUTCMonth() + 1,
      day: mondayDateOnly.getUTCDate(),
      hour: 8,
      minute: 0,
      second: 0,
    },
    BERLIN_TIMEZONE
  );

  const end = new Date(start.getTime() + 7 * MS_PER_DAY);
  return { start, end };
}

export function getBerlinFourWeekWindow(now = new Date()) {
  const weekWindow = getBerlinWeekWindow(now);

  return {
    start: new Date(weekWindow.start.getTime() - 21 * MS_PER_DAY),
    end: weekWindow.end,
  };
}

// Whole calendar month in Berlin time: from 00:00 on the 1st up to 00:00 on the 1st of the next month.
export function getBerlinMonthWindow(monthOffset = 0, now = new Date()) {
  const berlinNow = getTzParts(now, BERLIN_TIMEZONE);
  const startOfMonth = (month) =>
    zonedDateTimeToUtcDate({ year: berlinNow.year, month, day: 1, hour: 0, minute: 0, second: 0 }, BERLIN_TIMEZONE);

  return {
    start: startOfMonth(berlinNow.month + monthOffset),
    end: startOfMonth(berlinNow.month + monthOffset + 1),
  };
}

export function getWindowForTimeframe(timeframeDays) {
  if (timeframeDays === 'month') {
    return getBerlinMonthWindow(0);
  }

  if (timeframeDays === 'week' || timeframeDays === 7) {
    return getBerlinWeekWindow();
  }

  if (timeframeDays === 28) {
    return getBerlinFourWeekWindow();
  }

  const end = new Date();
  const start = new Date(end.getTime() - timeframeDays * MS_PER_DAY);
  return { start, end };
}

export function getBucketStepMs(interval) {
  if (interval === 'week') return 7 * MS_PER_DAY;
  if (interval === 'day') return MS_PER_DAY;
  return MS_PER_HOUR;
}

export function formatBucketLabel(date, interval) {
  if (interval === 'hour') return `${dateOnlyFormatter.format(date)} ${hourOnlyFormatter.format(date)}`;
  if (interval === 'day') return dateOnlyFormatter.format(date);
  return `Wk ${dateOnlyFormatter.format(date)}`;
}

function getBucketStarts(interval, window) {
  const rawStartMs = window.start.getTime();
  const rawEndMs = window.end.getTime();

  // Hourly buckets are aligned to exact hour boundaries for stable chart labels.
  if (interval === 'hour') {
    const startMs = Math.floor(rawStartMs / MS_PER_HOUR) * MS_PER_HOUR;
    const endMs = Math.ceil(rawEndMs / MS_PER_HOUR) * MS_PER_HOUR;
    const bucketCount = Math.max(1, Math.ceil((endMs - startMs) / MS_PER_HOUR));
    return Array.from({ length: bucketCount }, (_, index) => startMs + index * MS_PER_HOUR);
  }

  // Day and week buckets step in Berlin wall-clock days, so a clock change inside the window does not shift the labels.
  const daysPerBucket = interval === 'week' ? 7 : 1;
  const startParts = getTzParts(window.start, BERLIN_TIMEZONE);
  const starts = [];

  for (let index = 0; ; index += 1) {
    const bucketStartMs = zonedDateTimeToUtcDate(
      { ...startParts, day: startParts.day + index * daysPerBucket },
      BERLIN_TIMEZONE
    ).getTime();

    if (index > 0 && bucketStartMs >= rawEndMs) break;
    starts.push(bucketStartMs);
  }

  return starts;
}

// "yyyy-MM-dd" of the Berlin calendar day, the same key the backend uses for its daily counts.
export function toBerlinDayKey(date) {
  const parts = getTzParts(date, BERLIN_TIMEZONE);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function toTimeHistogram(issues, interval, window) {
  const starts = getBucketStarts(interval, window);

  const bins = starts.map((startMs, index) => {
    const bucketStart = new Date(startMs);

    return {
      xKey: `${bucketStart.toISOString()}_${index}`,
      period: formatBucketLabel(bucketStart, interval),
      tickets: 0,
      sortKey: bucketStart.getTime(),
    };
  });

  for (const issue of issues ?? []) {
    const created = issue?.fields?.created;
    if (!created) continue;

    const createdDate = new Date(created);
    if (Number.isNaN(createdDate.getTime())) continue;
    if (createdDate < window.start || createdDate >= window.end) continue;

    const createdMs = createdDate.getTime();
    let bucketIndex = -1;
    for (let i = 0; i < starts.length && starts[i] <= createdMs; i += 1) bucketIndex = i;

    if (bucketIndex >= 0 && bucketIndex < bins.length) {
      bins[bucketIndex].tickets += 1;
    }
  }

  return bins
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((bin) => ({
      xKey: bin.xKey,
      period: bin.period,
      dayKey: toBerlinDayKey(new Date(bin.sortKey)),
      tickets: bin.tickets,
      series: 'Tickets',
      isWeekend: interval !== 'week' && ['Sat', 'Sun'].includes(getTzParts(new Date(bin.sortKey), BERLIN_TIMEZONE).weekday),
    }));
}

export function buildSearchJql(userJql) {
  const trimmed = (userJql ?? '').trim();
  if (!trimmed) return DEFAULT_JQL;
  if (/\border\s+by\b/i.test(trimmed)) return trimmed;
  return `${trimmed} ORDER BY created DESC`;
}

export function formatJqlDate(date) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const parts = getTzParts(date, BERLIN_TIMEZONE);
  return `${parts.year}/${pad2(parts.month)}/${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function stripOrderByClause(jql) {
  return (jql ?? '').replace(/\s+order\s+by\b[\s\S]*$/i, '').trim();
}
