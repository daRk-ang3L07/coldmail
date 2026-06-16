import { useEffect, useState } from 'react';
import { api, CONNECT_URL } from './api.js';
import Contacts from './components/Contacts.jsx';
import Templates from './components/Templates.jsx';
import Campaigns from './components/Campaigns.jsx';

const NAV = [
  { id: 'contacts', label: 'Contacts', icon: '👥' },
  { id: 'templates', label: 'Templates', icon: '📝' },
  { id: 'campaigns', label: 'Campaigns', icon: '📤' },
];

export default function App() {
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('contacts');
  const [search, setSearch] = useState('');

  async function refreshStatus() {
    try {
      setStatus(await api.get('/auth/status'));
    } catch {
      setStatus({ active: null, accounts: [] });
    }
  }
  useEffect(() => {
    refreshStatus();
  }, []);

  const connected = !!status?.active;

  async function logout() {
    await api.post('/auth/logout');
    refreshStatus();
  }

  if (!connected) {
    return (
      <div className="connect-wrap">
        <div className="connect-card">
          <div style={{ fontSize: 40 }}>📧</div>
          <h1>Cold<span style={{ color: 'var(--red)' }}>Mail</span> — HR Outreach</h1>
          <p className="muted">
            Emails are sent through your own Gmail account for the best deliverability.
            Connect your account to begin.
          </p>
          <a href={CONNECT_URL}>
            <button style={{ marginTop: 12 }}>Connect Gmail</button>
          </a>
          {status?.accounts?.length > 0 && (
            <p className="muted" style={{ marginTop: 16 }}>
              Previously connected: {status.accounts.join(', ')}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="gm">
      <header className="gm-header">
        <div className="gm-brand">📧 <b>Cold<span className="r">Mail</span></b></div>
        <div className="gm-search">
          🔍
          <input
            placeholder="Search contacts"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (e.target.value) setTab('contacts');
            }}
          />
        </div>
        <div className="gm-account">
          <span className="email">{status.active}</span>
          <div className="avatar" title={status.active}>{status.active[0]}</div>
          <button className="ghost sm" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="gm-shell">
        <aside className="gm-side">
          <button className="gm-compose" onClick={() => setTab('campaigns')}>
            <span className="plus">＋</span> New campaign
          </button>
          <nav>
            {NAV.map((n) => (
              <div
                key={n.id}
                className={`gm-nav ${tab === n.id ? 'active' : ''}`}
                onClick={() => setTab(n.id)}
              >
                <span className="ic">{n.icon}</span> {n.label}
              </div>
            ))}
          </nav>
        </aside>

        <main className="gm-main">
          <div className="gm-main-inner">
            {tab === 'contacts' && <Contacts search={search} />}
            {tab === 'templates' && <Templates />}
            {tab === 'campaigns' && <Campaigns />}
          </div>
        </main>
      </div>
    </div>
  );
}
