import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Contacts({ search = '' }) {
  const [lists, setLists] = useState([]);
  const [activeList, setActiveList] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newListName, setNewListName] = useState('');
  const fileRef = useRef();

  async function loadLists() {
    const r = await api.get('/lists');
    setLists(r.lists);
    // keep selection valid; default to first list
    setActiveList((cur) => {
      if (cur && r.lists.some((l) => l.id === cur)) return cur;
      return r.lists[0]?.id ?? null;
    });
    return r.lists;
  }
  useEffect(() => {
    loadLists();
  }, []);

  async function loadContacts() {
    if (!activeList) {
      setContacts([]);
      setTotal(0);
      return;
    }
    const r = await api.get('/contacts?listId=' + activeList + '&limit=500');
    setContacts(r.contacts);
    setTotal(r.total);
  }
  useEffect(() => {
    loadContacts();
  }, [activeList]);

  async function createList() {
    const name = newListName.trim();
    if (!name) return;
    const l = await api.post('/lists', { name });
    setNewListName('');
    await loadLists();
    setActiveList(l.id);
  }

  async function deleteList() {
    if (!activeList) return;
    const l = lists.find((x) => x.id === activeList);
    if (!confirm(`Delete list "${l?.name}" and all ${l?.count} of its contacts?`)) return;
    await api.del('/lists/' + activeList);
    setActiveList(null);
    await loadLists();
  }

  async function upload() {
    const file = fileRef.current.files[0];
    if (!file) return alert('Choose a file first.');
    if (!activeList) return alert('Create or select a list first.');
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('listId', activeList);
      const res = await fetch('/contacts/upload', { method: 'POST', body: fd });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error);
      setResult({
        ok: true,
        msg: `Added ${r.added} new · ${r.duplicates} duplicates skipped · ${r.skippedInvalid} invalid skipped (of ${r.total} rows).`,
      });
      fileRef.current.value = '';
      loadContacts();
      loadLists();
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    await api.del('/contacts/' + id);
    loadContacts();
    loadLists();
  }

  const q = search.trim().toLowerCase();
  const shown = q
    ? contacts.filter((c) =>
        [c.email, c.full_name, c.company, c.role].some((v) => (v || '').toLowerCase().includes(q)),
      )
    : contacts;

  return (
    <>
      <div className="card">
        <h2>Contact lists</h2>
        <p className="hint">
          Each uploaded sheet goes into a list. Campaigns target one list — so you can keep,
          say, “Startups” and “Big Co” separate. (An email already in any list is skipped on
          re-upload, so nobody gets emailed twice.)
        </p>

        {lists.length === 0 ? (
          <p className="muted">No lists yet. Create your first list below.</p>
        ) : (
          <div className="chips">
            {lists.map((l) => (
              <button
                key={l.id}
                className={`chip ${activeList === l.id ? 'active' : ''}`}
                onClick={() => setActiveList(l.id)}
              >
                {l.name} ({l.count})
              </button>
            ))}
          </div>
        )}

        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 2 }}>
            <label>New list name</label>
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createList()}
              placeholder="e.g. Startups — June"
            />
          </div>
          <div style={{ flex: 0 }}>
            <button onClick={createList}>Create list</button>
          </div>
        </div>
      </div>

      {activeList && (
        <div className="card">
          <h2>
            {lists.find((l) => l.id === activeList)?.name} <span className="pill">{total}</span>
          </h2>
          <p className="hint">
            Upload an Excel (.xlsx/.xls) or CSV into this list. Columns like{' '}
            <code>email, name, company, role</code> are auto-detected.
          </p>

          <div className="btnrow">
            <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv" style={{ maxWidth: 320 }} />
            <button onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Upload to this list'}</button>
            <button className="ghost" onClick={deleteList}>Delete list</button>
          </div>

          {result && <div className={`notice ${result.ok ? 'ok' : 'err'}`}>{result.msg}</div>}

          <div style={{ marginTop: 16 }}>
            {contacts.length === 0 ? (
              <p className="muted">No contacts in this list yet. Upload a file above.</p>
            ) : shown.length === 0 ? (
              <p className="muted">No contacts match “{search}”.</p>
            ) : (
              <div className="scroll">
                {q && <div className="muted" style={{ padding: '6px 8px' }}>{shown.length} of {total} match “{search}”</div>}
                <table>
                  <thead>
                    <tr><th>Email</th><th>Name</th><th>Company</th><th>Role</th><th></th></tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.id}>
                        <td>{c.email}</td>
                        <td>{c.full_name || '—'}</td>
                        <td>{c.company || '—'}</td>
                        <td>{c.role || '—'}</td>
                        <td><button className="ghost sm" onClick={() => remove(c.id)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
