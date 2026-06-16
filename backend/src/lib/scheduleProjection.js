// Pure projection of when each contact would receive emails, replaying the
// scheduler's rules WITHOUT sending anything. Follow-ups are projected assuming
// nobody replies (the maximum-volume case) — real volume will be lower as
// people reply and drop out of the sequence.

function parseHHMM(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param {object} cfg
 * @param {Array<{id,email,name}>} cfg.recipients  in send order
 * @param {number} cfg.dailyCap
 * @param {number} cfg.intervalSeconds
 * @param {string} cfg.windowStart  'HH:MM'
 * @param {string} cfg.windowEnd    'HH:MM'
 * @param {string} cfg.sendDays     csv of 0..6
 * @param {number|null} cfg.startAtMs
 * @param {Array<{delayDays:number}>} cfg.followups
 * @param {number} cfg.nowMs        fallback start (today) when no startAt
 * @param {number} [cfg.maxDays=366]
 */
export function projectSchedule(cfg) {
  const recipients = cfg.recipients || [];
  const followups = cfg.followups || [];
  const totalSteps = followups.length;
  const maxDays = cfg.maxDays || 366;

  // Per-day send capacity = min(daily cap, how many fit in the window at the
  // chosen interval).
  const winLen = Math.max(0, parseHHMM(cfg.windowEnd) - parseHHMM(cfg.windowStart));
  const intervalMin = Math.max(cfg.intervalSeconds, 1) / 60;
  const capacityByWindow = winLen <= 0 ? 1 : Math.floor(winLen / intervalMin) + 1;
  const perDay = Math.max(1, Math.min(cfg.dailyCap, capacityByWindow));

  const allowedDays = new Set(String(cfg.sendDays || '1,2,3,4,5').split(',').map(Number));

  // Start at the date of startAt (or today). Day granularity.
  const base = new Date(cfg.startAtMs || cfg.nowMs);
  const startMidnight = new Date(base.getFullYear(), base.getMonth(), base.getDate());

  // Per-contact simulation state.
  const state = recipients.map((r) => ({ r, initialSent: false, stage: 0, lastDay: null }));
  const hasWork = (s) => !s.initialSent || s.stage < totalSteps;

  const days = [];
  let totalSends = 0;
  let truncated = false;

  for (let dayIndex = 0; dayIndex < maxDays; dayIndex++) {
    if (!state.some(hasWork)) break;
    if (dayIndex === maxDays - 1 && state.some(hasWork)) truncated = true;

    const date = new Date(startMidnight.getFullYear(), startMidnight.getMonth(), startMidnight.getDate() + dayIndex);
    if (!allowedDays.has(date.getDay())) continue; // not a sending day

    let slots = perDay;
    const sends = [];

    while (slots > 0) {
      // Engine priority: due follow-ups first (earliest lastDay), then initials.
      let pick = null;
      let pickIsFollowup = false;
      let earliest = Infinity;
      for (const s of state) {
        if (s.initialSent && s.stage < totalSteps) {
          const delay = followups[s.stage].delayDays;
          if (dayIndex - s.lastDay >= delay && s.lastDay < earliest) {
            earliest = s.lastDay;
            pick = s;
            pickIsFollowup = true;
          }
        }
      }
      if (!pick) {
        pick = state.find((s) => !s.initialSent) || null; // next initial in order
        pickIsFollowup = false;
      }
      if (!pick) break; // nothing ready today

      if (pickIsFollowup) {
        pick.stage += 1;
        pick.lastDay = dayIndex;
        sends.push({ email: pick.r.email, name: pick.r.name || '', type: 'follow-up', step: pick.stage });
      } else {
        pick.initialSent = true;
        pick.lastDay = dayIndex;
        sends.push({ email: pick.r.email, name: pick.r.name || '', type: 'initial', step: 0 });
      }
      slots--;
      totalSends++;
    }

    if (sends.length) {
      days.push({ date: ymd(date), weekday: DAY_NAMES[date.getDay()], sends });
    }
  }

  return {
    perDay,
    capacityByWindow,
    totalRecipients: recipients.length,
    totalSends,
    totalFollowupSends: totalSends - recipients.length,
    sendingDays: days.length,
    finishDate: days.length ? days[days.length - 1].date : null,
    assumedNoReplies: totalSteps > 0,
    truncated,
    days,
  };
}
