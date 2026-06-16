import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { DAY_NAMES, DEFAULT_DAYS } from '../utils.js';
import CampaignList from './CampaignList.jsx';

export default function Campaigns() {
  const [templates, setTemplates] = useState([]);
  const [lists, setLists] = useState([]);
  const [version, setVersion] = useState(0); // bump to force list reload

  // form state
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [listId, setListId] = useState('');
  const [dailyCap, setDailyCap] = useState(50);
  const [gapMin, setGapMin] = useState(2);
  const [gapMax, setGapMax] = useState(5);
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [startAt, setStartAt] = useState('');
  const [followups, setFollowups] = useState([]);

  const [notice, setNotice] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [openDay, setOpenDay] = useState(0);

  useEffect(() => {
    api.get('/templates').then((r) => setTemplates(r.templates));
    api.get('/lists').then((r) => {
      setLists(r.lists);
      setListId((cur) => cur || (r.lists[0]?.id ? String(r.lists[0].id) : ''));
    });
  }, []);

  const selectedList = lists.find((l) => String(l.id) === String(listId));

  function toggleDay(d) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }
  function addFollowup() {
    setFollowups((f) => [...f, { delayDays: 3, body: '' }]);
  }
  function updateFollowup(i, key, val) {
    setFollowups((f) => f.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)));
  }
  function removeFollowup(i) {
    setFollowups((f) => f.filter((_, idx) => idx !== i));
  }

  function payload() {
    return {
      name,
      templateId: Number(templateId),
      listId: listId ? Number(listId) : undefined,
      dailyCap: Number(dailyCap),
      intervalMinSeconds: Math.round(Number(gapMin) * 60),
      intervalMaxSeconds: Math.round(Number(gapMax) * 60),
      windowStart,
      windowEnd,
      sendDays: days,
      startAt: startAt || undefined,
      followups: followups.filter((f) => f.body.trim()),
    };
  }

  async function preview() {
    if (!days.length) return alert('Pick at least one day.');
    setTimeline({ loading: true });
    try {
      const r = await api.post('/campaigns/preview-schedule', payload());
      setTimeline(r);
      setOpenDay(0);
    } catch (e) {
      setTimeline(null);
      setNotice({ ok: false, msg: e.message });
    }
  }

  async function create() {
    if (!name) return setNotice({ ok: false, msg: 'Give the campaign a name.' });
    if (!templateId) return setNotice({ ok: false, msg: 'Select a template (save one first).' });
    if (!listId) return setNotice({ ok: false, msg: 'Select a contact list to send to.' });
    if (!days.length) return setNotice({ ok: false, msg: 'Pick at least one day to send on.' });
    try {
      const c = await api.post('/campaigns', payload());
      setNotice({ ok: true, msg: `Created "${c.name}" with ${c.progress.total} recipients. Click Start in the list below.` });
      setVersion((v) => v + 1);
    } catch (e) {
      setNotice({ ok: false, msg: e.message });
    }
  }

  return (
    <>
      <div className="card">
        <h2>New campaign</h2>
        <p className="hint">Sends your template to your contacts, paced by these rules. Runs in the background; pause/resume anytime. Each send waits a random gap between your min and max (e.g. 2–5 min) so it looks human.</p>

        <label>Campaign name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR outreach — June" />

        <label>Template</label>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">{templates.length ? '— select —' : '(save a template first)'}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <label>Send to list</label>
        <select value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">{lists.length ? '— select —' : '(create a list first)'}</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>{l.name} ({l.count})</option>
          ))}
        </select>

        <div className="row">
          <div>
            <label>Daily cap</label>
            <input type="number" value={dailyCap} min={1} max={2000} onChange={(e) => setDailyCap(e.target.value)} />
          </div>
          <div>
            <label>Min gap (minutes)</label>
            <input type="number" value={gapMin} min={1} step={1} onChange={(e) => setGapMin(e.target.value)} />
          </div>
          <div>
            <label>Max gap (minutes)</label>
            <input type="number" value={gapMax} min={1} step={1} onChange={(e) => setGapMax(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>Send window start</label>
            <input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
          </div>
          <div>
            <label>Send window end</label>
            <input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          </div>
        </div>

        <label>Send on days</label>
        <div className="chips">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} className="weekday">
              <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />
              {DAY_NAMES[d]}
            </label>
          ))}
        </div>

        <label>Start at (optional — blank = begin when you click Start)</label>
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />

        <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border)' }} />
        <h2 style={{ fontSize: '1rem' }}>Follow-ups (reminders)</h2>
        <p className="hint">Auto-sent in the same thread, only to people who haven't replied. Delay counts from the previous message.</p>
        {followups.map((f, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <label>
              Send{' '}
              <input
                type="number" min={0} value={f.delayDays}
                onChange={(e) => updateFollowup(i, 'delayDays', Number(e.target.value))}
                style={{ width: 70, display: 'inline-block' }}
              />{' '}
              days after previous message (if no reply)
            </label>
            <textarea
              rows={4} value={f.body}
              onChange={(e) => updateFollowup(i, 'body', e.target.value)}
              placeholder="Hi {{firstName|there}}, just following up on my note below…"
            />
            <button className="ghost sm" style={{ marginTop: 6 }} onClick={() => removeFollowup(i)}>Remove</button>
          </div>
        ))}
        <button className="ghost" onClick={addFollowup}>+ Add follow-up</button>

        <p className="muted" style={{ marginTop: 14 }}>
          {selectedList ? `Will send to ${selectedList.count} contacts in “${selectedList.name}”.` : 'Select a list to send to.'}
        </p>
        <div className="btnrow">
          <button className="ghost" onClick={preview}>Preview timeline</button>
          <button onClick={create}>Create campaign</button>
        </div>

        {notice && <div className={`notice ${notice.ok ? 'ok' : 'err'}`}>{notice.msg}</div>}

        {timeline && <Timeline data={timeline} openDay={openDay} setOpenDay={setOpenDay} />}
      </div>

      <CampaignList version={version} />
    </>
  );
}

function Timeline({ data, openDay, setOpenDay }) {
  if (data.loading) return <div className="notice info">Calculating…</div>;
  const day = data.days[openDay];
  return (
    <div className="notice info" style={{ marginTop: 12 }}>
      <div>
        <b>{data.totalSends}</b> emails ({data.totalRecipients} initial + {data.totalFollowupSends} follow-up) over{' '}
        <b>{data.sendingDays}</b> sending day{data.sendingDays !== 1 ? 's' : ''}, ~{data.perDay}/day · finishes{' '}
        <b>{data.finishDate}</b>
        {data.assumedNoReplies && ' · follow-ups assume nobody replies (max volume)'}
      </div>
      <div className="chips">
        {data.days.map((d, i) => (
          <button key={i} className={`chip ${i === openDay ? 'active' : ''}`} onClick={() => setOpenDay(i)}>
            {d.weekday} {d.date.slice(5)} <b>({d.sends.length})</b>
          </button>
        ))}
      </div>
      {day && (
        <>
          <div className="muted" style={{ marginBottom: 6 }}>
            {day.weekday} {day.date} — {day.sends.length} email{day.sends.length !== 1 ? 's' : ''}
          </div>
          <div className="scroll" style={{ maxHeight: 220 }}>
            <table>
              <tbody>
                {day.sends.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name || s.email}</td>
                    <td className="muted">{s.email}</td>
                    <td>{s.type === 'initial' ? '✉️ initial' : '🔁 follow-up #' + s.step}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
