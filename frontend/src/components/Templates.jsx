import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [selId, setSelId] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [previewContact, setPreviewContact] = useState('');
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState(null);

  async function loadTemplates() {
    const r = await api.get('/templates');
    setTemplates(r.templates);
  }
  async function loadContacts() {
    const r = await api.get('/contacts?limit=500');
    setContacts(r.contacts);
  }
  useEffect(() => {
    loadTemplates();
    loadContacts();
  }, []);

  function selectTemplate(id) {
    setSelId(id);
    setPreview(null);
    const t = templates.find((x) => String(x.id) === String(id));
    setName(t ? t.name : '');
    setSubject(t ? t.subject : '');
    setBody(t ? t.body : '');
  }

  async function insertStarter() {
    const t = await api.get('/templates/starter');
    setSelId('');
    setName(t.name);
    setSubject(t.subject);
    setBody(t.body);
  }

  async function save() {
    if (!name || !subject || !body) return setNotice({ ok: false, msg: 'Name, subject and body are required.' });
    try {
      const saved = selId
        ? await api.put('/templates/' + selId, { name, subject, body })
        : await api.post('/templates', { name, subject, body });
      await loadTemplates();
      setSelId(String(saved.id));
      setNotice({ ok: true, msg: 'Saved.' });
    } catch (e) {
      setNotice({ ok: false, msg: e.message });
    }
  }

  async function remove() {
    if (!selId || !confirm('Delete this template?')) return;
    await api.del('/templates/' + selId);
    selectTemplate('');
    loadTemplates();
  }

  async function doPreview() {
    const r = await api.post('/templates/preview', {
      subject, body, contactId: previewContact || undefined,
    });
    setPreview(r);
    if (r.note) setNotice({ ok: true, msg: r.note });
  }

  async function sendTest() {
    if (!confirm('Send a REAL email to the selected contact?')) return;
    try {
      const r = await api.post('/templates/send-test', {
        subject, body, contactId: previewContact || undefined,
      });
      setNotice({ ok: true, msg: 'Sent to ' + r.to });
    } catch (e) {
      setNotice({ ok: false, msg: e.message });
    }
  }

  return (
    <div className="card">
      <h2>Email template</h2>
      <p className="hint">
        Use <code>{'{{firstName}}'}</code>, <code>{'{{company}}'}</code>, <code>{'{{role}}'}</code>. Add a fallback
        with <code>{'{{firstName|there}}'}</code>. Square brackets like <code>[Your Name]</code> are filled in
        once by you, not merged.
      </p>

      <label>Saved templates</label>
      <div className="btnrow" style={{ marginTop: 0 }}>
        <select value={selId} onChange={(e) => selectTemplate(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">— New template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button className="ghost" onClick={insertStarter}>Insert starter (HR cold email)</button>
      </div>

      <label>Template name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR outreach v1" />
      <label>Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="{{firstName|Hello}} — interested in roles at {{company}}" />
      <label>Body</label>
      <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />

      <div className="btnrow">
        <button onClick={save}>Save / Update</button>
        {selId && <button className="ghost" onClick={remove}>Delete</button>}
      </div>

      {notice && <div className={`notice ${notice.ok ? 'ok' : 'err'}`}>{notice.msg}</div>}

      <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid var(--border)' }} />
      <h2 style={{ fontSize: '1rem' }}>Preview &amp; test</h2>
      <label>Preview as contact</label>
      <select value={previewContact} onChange={(e) => setPreviewContact(e.target.value)}>
        <option value="">most recent contact</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>{(c.full_name || c.email) + ' — ' + c.email}</option>
        ))}
      </select>
      <div className="btnrow">
        <button className="ghost" onClick={doPreview}>Preview merge</button>
        <button onClick={sendTest}>Send test to this contact</button>
      </div>

      {preview && (
        <div className="notice info" style={{ marginTop: 12 }}>
          <div className="muted">Subject:</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{preview.subject}</div>
          <div className="muted">Body:</div>
          <div dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      )}
    </div>
  );
}
