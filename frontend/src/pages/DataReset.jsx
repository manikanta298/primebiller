import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function DataReset() {
  const [info, setInfo] = useState(null), [scope, setScope] = useState('transactions'), [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);
  const load = () => api('/admin/data-reset/preview').then((d) => { setInfo(d); setMsg(null); }).catch((e) => setMsg({ err: true, text: e.message }));
  useEffect(() => { load(); }, []);

  const tables = info?.scopes[scope]?.tables || [];
  const total = tables.reduce((n, t) => n + t.count, 0);
  const ready = info && confirm === info.confirmPhrase && total > 0 && !busy;
  const run = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/data-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, confirm }) });
      setMsg({ text: `Deleted ${r.deleted.reduce((n, d) => n + d.count, 0)} rows.` });
      setConfirm(''); await api('/admin/data-reset/preview').then(setInfo);
    } catch (e) { setMsg({ err: true, text: e.message }); } finally { setBusy(false); }
  };

  return <div className="gd-settings-section" aria-label="Delete test data">
    <div><h3>Delete test data</h3><p>Permanently removes rows so you can start clean. Your organization, units and user accounts are always kept. Only the master admin can do this, and it cannot be undone.</p></div>
    {!info && !msg && <p>Loading…</p>}
    {info && <>
      {Object.entries(info.scopes).map(([k, s]) => <label key={k} className="gd-check"><input type="radio" name="reset-scope" checked={scope === k} onChange={() => { setScope(k); setConfirm(''); }} /> {s.label}</label>)}
      <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>TABLE</th><th>ROWS TO DELETE</th></tr></thead>
        <tbody>{tables.filter((t) => t.count > 0).map((t) => <tr key={t.table}><td className="gd-mono">{t.table}</td><td>{t.count}</td></tr>)}
          {total === 0 && <tr><td colSpan="2">Nothing to delete for this choice.</td></tr>}</tbody></table></div>
      <label><small>TYPE “{info.confirmPhrase}” TO CONFIRM</small><input aria-label="Confirmation phrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      <button className="gd-btn pri" disabled={!ready} onClick={run}>{busy ? 'Deleting…' : `Delete ${total} rows`}</button>
    </>}
    {msg && <p role="status" className={msg.err ? 'gd-form-err' : 'gd-success'}>{msg.text}</p>}
  </div>;
}
