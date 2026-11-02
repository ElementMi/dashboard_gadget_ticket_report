// Colour scale of the status heatmap: deep purple, magenta, red, soft pink (no black, no yellow).
// Position 0 is the darkest colour and position 1 the lightest.
const STOPS = [
  [0, '#431D58'],
  [0.33, '#8E1C5E'],
  [0.66, '#D4435B'],
  [1, '#F7B6AE'],
];

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function rampColor(position) {
  const t = Math.max(0, Math.min(1, position));
  for (let i = 1; i < STOPS.length; i += 1) {
    if (t <= STOPS[i][0]) {
      const [t0, hex0] = STOPS[i - 1];
      const [t1, hex1] = STOPS[i];
      const u = (t - t0) / (t1 - t0);
      const a = hexToRgb(hex0);
      const b = hexToRgb(hex1);
      return a.map((channel, k) => Math.round(channel + (b[k] - channel) * u));
    }
  }
  return hexToRgb(STOPS[STOPS.length - 1][1]);
}

// White on dark colours, near-black on light ones.
export function textColorOn(rgb) {
  const linear = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.18 ? '#111111' : '#FFFFFF';
}

const STOPS_CSS = STOPS.map(([t, hex]) => `${hex} ${t * 100}%`).join(', ');

// Colour bar next to the table. Normal: light (many tickets) at the top. Reversed: dark (many tickets) at the top.
export const BAR_NORMAL = `linear-gradient(to top, ${STOPS_CSS})`;
export const BAR_REVERSED = `linear-gradient(to bottom, ${STOPS_CSS})`;
