export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Default weekday selection: Mon–Fri.
export const DEFAULT_DAYS = [1, 2, 3, 4, 5];

export function formatDays(csv) {
  const ds = String(csv || '').split(',').map(Number).filter((n) => !isNaN(n)).sort();
  const key = ds.join(',');
  if (key === '1,2,3,4,5') return 'Mon–Fri';
  if (key === '0,1,2,3,4,5,6') return 'every day';
  return ds.map((d) => DAY_NAMES[d]).join(', ');
}

export function fmtTime(ms) {
  return ms ? new Date(ms).toLocaleString() : '—';
}
