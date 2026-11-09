// Zone status / severity colours for SVG and inline styles (mirror of the --color-st-* tokens in wayve.css).
import type { Severity, ZoneStatus } from '@shared/contracts';

export const STATUS_COLOR: Record<ZoneStatus, { dot: string; fg: string; fill: string; stroke: string }> = {
  unknown: { dot: '#b9b8b4', fg: '#6b6965', fill: 'rgba(23,21,15,.025)', stroke: 'rgba(23,21,15,.16)' },
  clear: { dot: '#58a069', fg: '#376c45', fill: 'rgba(88,160,105,.12)', stroke: 'rgba(88,160,105,.55)' },
  busy: { dot: '#c9a13f', fg: '#7a5d14', fill: 'rgba(201,161,63,.14)', stroke: 'rgba(201,161,63,.6)' },
  crowded: { dot: '#c6824b', fg: '#86552e', fill: 'rgba(198,130,75,.16)', stroke: 'rgba(198,130,75,.65)' },
  critical: { dot: '#c8553f', fg: '#8d3427', fill: 'rgba(200,85,63,.18)', stroke: 'rgba(200,85,63,.75)' },
  alert: { dot: '#b91c1c', fg: '#b91c1c', fill: 'rgba(185,28,28,.14)', stroke: '#b91c1c' },
};

export const SEVERITY_COLOR: Record<Severity, string> = { low: '#8a8884', medium: '#c6824b', high: '#c8553f', critical: '#b91c1c' };
