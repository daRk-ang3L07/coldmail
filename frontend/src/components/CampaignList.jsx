import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDays, fmtTime } from '../utils.js';

export default function CampaignList({ version }) {
  const [campaigns, setCampaigns] = useState([]);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/campaigns');
      setCampaigns(r.campaigns);
    } catch {
      /* not connected yet */
    }
  }, []);

  // Reload on mount, when a campaign is created (version), and every 5s.
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, version]);

  async function action(id, act) {
    await api.post(`/campaigns/${id}/${act}`);
    load();
  }
  async function remove(id) {
    if (!confirm('Delete this campaign? (does not unsend already-sent mail)')) return;
    if (openId === id) setOpenId(null);
    await api.del('/campaigns/' + id);
    load();
  }
  async function addAttachment(id, file) {
    try {
      await api.upload('/campaigns/' + id + '/attachments', file);
    } catch (e) {
      alert(e.message);
    }
    load();
  }
  async function removeAttachment(id, attId) {
    await api.del(`/campaigns/${id}/attachments/${attId}`);
    load();
  }

  if (!campaigns.length) {
    return (
      <div className="card">
        <h2>Campaigns</h2>
        <p className="muted">No campaigns yet. Create one above.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Campaigns</h2>
      {campaigns.map((c) => {
        const p = c.progress;
        const done = p.sent + p.replied + p.failed + p.skipped;
        const pct = p.total ? Math.round((done / p.total) * 100) : 0;
        return (
          <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>{c.name}</b>
              <span className="pill">{c.status}</span>
            </div>
            <div className="bar"><div style={{ width: pct + '%' }} /></div>
            <div className="muted">
              {p.sent} sent · {p.replied} replied · {p.queued} queued · {p.failed} failed · {p.skipped} skipped (of {p.total})
              <br />
              cap {c.daily_cap}/day · every {Math.round(c.interval_min_seconds / 60)}–{Math.round(c.interval_max_seconds / 60)}m · {c.window_start}–{c.window_end} · {formatDays(c.send_days)}
              {c.followups?.length
                ? ` · ${c.followups.length} follow-up${c.followups.length > 1 ? 's' : ''} (${c.followups.map((f) => '+' + f.delay_days + 'd').join(', ')})`
                : ' · no follow-ups'}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              📎{' '}
              {c.attachments?.length
                ? c.attachments.map((a) => (
                    <span key={a.id} className="pill" style={{ marginRight: 6 }}>
                      {a.filename}{' '}
                      <span onClick={() => removeAttachment(c.id, a.id)} style={{ cursor: 'pointer' }} title="Remove">✕</span>
                    </span>
                  ))
                : 'no attachments'}
              <label style={{ marginLeft: 8, cursor: 'pointer', color: 'var(--primary)' }}>
                + add file
                <input
                  type="file"
                  style={{ display: 'none' }}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={(e) => e.target.files[0] && addAttachment(c.id, e.target.files[0])}
                />
              </label>
            </div>
            <div className="btnrow">
              {c.status === 'running' ? (
                <button className="ghost sm" onClick={() => action(c.id, 'pause')}>Pause</button>
              ) : c.status !== 'completed' ? (
                <button className="sm" onClick={() => action(c.id, 'start')}>Start</button>
              ) : null}
              <button className="ghost sm" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                {openId === c.id ? 'Hide details' : 'Details'}
              </button>
              <button className="ghost sm" onClick={() => remove(c.id)}>Delete</button>
            </div>
            {openId === c.id && <CampaignDetail campaign={c} />}
          </div>
        );
      })}
    </div>
  );
}

const STATUSES = ['', 'replied', 'sent', 'queued', 'failed', 'skipped'];

function CampaignDetail({ campaign }) {
  const [recipients, setRecipients] = useState([]);
  const [filter, setFilter] = useState('');
  const id = campaign.id;
  const totalSteps = campaign.followups?.length || 0;

  const load = useCallback(async () => {
    const r = await api.get('/campaigns/' + id + '/recipients' + (filter ? '?status=' + filter : ''));
    setRecipients(r.recipients);
  }, [id, filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function retry() {
    const r = await api.post('/campaigns/' + id + '/retry-failed');
    alert('Re-queued ' + r.requeued + ' failed email(s).');
    load();
  }

  const p = campaign.progress;
  const emailed = p.sent + p.replied;
  const replyRate = emailed > 0 ? Math.round((p.replied / emailed) * 100) : 0;

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="muted" style={{ marginBottom: 8 }}>
        Reply rate: <b style={{ color: 'var(--text)' }}>{replyRate}%</b> · Sent today: <b style={{ color: 'var(--text)' }}>{campaign.sentToday}</b>/{campaign.daily_cap}
      </div>
      <div className="chips">
        {STATUSES.map((s) => (
          <button key={s} className={`chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {s || 'All'}
          </button>
        ))}
        {p.failed > 0 && <button className="sm" onClick={retry}>Retry failed</button>}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr><th>Contact</th><th>Status</th><th>Sent</th><th>Stage</th><th>Error</th></tr>
          </thead>
          <tbody>
            {recipients.length === 0 ? (
              <tr><td colSpan={5} className="muted">No recipients in this filter.</td></tr>
            ) : (
              recipients.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || r.email}<div className="muted">{r.email}</div></td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td className="muted">{fmtTime(r.sent_at)}</td>
                  <td>{totalSteps ? `${r.stage}/${totalSteps}` : '—'}</td>
                  <td className="muted" style={{ color: r.error ? 'var(--red)' : undefined }}>{r.error || ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
