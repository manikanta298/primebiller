import React, { useEffect, useState } from 'react';
import { api } from '../api';

const H = { 'Content-Type': 'application/json' };
const FIXES = { UOM: 'Map BAGS → BAG', HSN: 'Pad HSN to 4 digits', DUP: 'Keep the first of each duplicate' };
const FIELD_ERR = { UOM: 'uom', HSN: 'hsn', RATE: 'rate', NEG: 'qty', DUP: 'sku', GODOWN: 'godown' };

export default function BulkImport() {
  const [s, setS] = useState(null), [rows, setRows] = useState([]), [only, setOnly] = useState(true), [msg, setMsg] = useState('');
  const load = async (id) => { const sum = await api(id ? `/imports/${id}` : '/imports/current'); setS(sum); if (sum) setRows(await api(`/imports/${sum.job.id}/rows?errorsOnly=${only ? 1 : 0}`)); };
  useEffect(() => { load(s?.job.id); }, [only]);
  if (!s) return <div className="gd-soon"><h1>Bulk import</h1><label className="gd-btn" style={{ display: 'inline-block' }}>Upload CSV<input type="file" accept=".csv" hidden onChange={async (e) => { const f = e.target.files[0]; if (!f) return; const r = await fetch(`${import.meta.env.VITE_AUTH_URL || 'http://localhost:3005'}/api/imports?filename=${encodeURIComponent(f.name)}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/csv' }, body: await f.text() }); const sum = await r.json(); setS(sum); setRows(await api(`/imports/${sum.job.id}/rows?errorsOnly=1`)); }} /></label><p>Columns: sku, name, uom, hsn, qty, rate, godown</p></div>;
  const { job, counts: c, kinds } = s, n = (x) => Number(x || 0).toLocaleString('en-IN');
  const editCell = async (row, field, value) => { try { setS(await api(`/imports/${job.id}/rows/${row}`, { method: 'PATCH', headers: H, body: JSON.stringify({ field, value }) })); setRows(await api(`/imports/${job.id}/rows?errorsOnly=${only ? 1 : 0}`)); setMsg(''); } catch (e) { setMsg(e.message); } };
  const bulk = async (kind) => { setS(await api(`/imports/${job.id}/bulk-fix`, { method: 'POST', headers: H, body: JSON.stringify({ kind }) })); setRows(await api(`/imports/${job.id}/rows?errorsOnly=${only ? 1 : 0}`)); };
  const commit = async () => { try { const r = await api(`/imports/${job.id}/commit`, { method: 'POST' }); setMsg(`Committed ${n(r.posted)} rows`); load(job.id); } catch (e) { setMsg(e.message); } };
  const kpi = (t, v, col) => <div className="gd-card gd-kpi"><small>{t}</small><b style={{ color: col }}>{n(v)}</b></div>;
  const done = job.status === 'COMMITTED';
  return (<>
    <div className="gd-h"><div><h1>Bulk import — opening stock</h1><p><span className="gd-mono">{job.filename}</span> · {n(job.rows_total)} rows · {msg || `status ${job.status}`}</p></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="gd-btn">Download error rows</button><button className="gd-btn" style={{ border: 0, background: 'none' }} onClick={async () => { await api(`/imports/${job.id}/cancel`, { method: 'POST' }); load(job.id); }}>Cancel import</button>
        <button className="gd-btn pri" onClick={commit} disabled={job.status !== 'VALIDATED'}>Commit {n(Number(c.valid) + 0)} valid rows</button></div></div>
    <div className="gd-card gd-steps">{['Upload', 'Map columns', 'Validate', 'Fix errors', 'Commit'].map((x, i) => <span key={x} className={i < 3 || done ? 'done' : i === 3 ? 'cur' : ''}><i>{i < 3 || done ? '✓' : i + 1}</i>{x}</span>)}<em>Status <b style={{ color: 'var(--ink)' }}>{job.status}</b> — commit is allowed from this state only</em></div>
    <div className="gd-kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)', margin: '16px 0' }}>{kpi('ROWS PARSED', c.total)}{kpi('VALID', c.valid, '#1d6b43')}{kpi('WITH ERRORS', c.errors, 'var(--red)')}{kpi('FIXED SO FAR', c.fixed, 'var(--teal)')}</div>
    <div className="gd-two" style={{ gridTemplateColumns: '275px 1fr', alignItems: 'start' }}>
      <div className="gd-card"><div className="gd-ch"><h3>Errors by kind</h3></div>
        <table className="gd-t"><thead><tr><th>PROBLEM</th><th className="gd-r">ROWS</th></tr></thead><tbody>{kinds.map((k, i) => <tr key={k.kind}><td style={{ color: i === 0 ? 'var(--red)' : 'inherit', fontWeight: i === 0 ? 600 : 400 }}>{k.label}</td><td className="gd-r gd-mono">{n(k.rows)}</td></tr>)}</tbody></table>
        <div style={{ padding: 16 }}><small className="gd-cap">BULK FIXES</small>{Object.entries(FIXES).map(([k, l]) => { const cnt = kinds.find((x) => x.kind === k)?.rows || 0; return <button key={k} className="gd-btn" style={{ display: 'block', width: '100%', textAlign: 'left', margin: '8px 0' }} onClick={() => bulk(k)}>{l} ({n(cnt)}{k === 'UOM' ? ' rows' : ''})</button>; })}</div></div>
      <div className="gd-card"><div className="gd-ch"><h3>Rows with errors — edit in place</h3><div className="gd-chips"><button className={`gd-chip${only ? ' on' : ''}`} onClick={() => setOnly(true)}>Errors only<em>{n(c.remaining)}</em></button><button className={`gd-chip${!only ? ' on' : ''}`} onClick={() => setOnly(false)}>All rows<em>{n(c.total)}</em></button></div></div>
        <table className="gd-t"><thead><tr><th>ROW</th><th>SKU</th><th>ITEM NAME</th><th>UOM</th><th>HSN</th><th>OPENING QTY</th><th>RATE</th></tr></thead>
          <tbody>{rows.slice(0, 8).map((r) => { const p = r.payload; const bad = r.error_kind && !r.fixed ? FIELD_ERR[r.error_kind] : null;
            const cell = (f) => bad === f ? <div><input className="gd-err" defaultValue={p[f]} onBlur={(e) => e.target.value !== String(p[f]) && editCell(r.row_no, f, e.target.value)} /><small style={{ color: 'var(--red)', display: 'block', fontSize: 11 }}>{r.error_msg}</small></div> : <span className="gd-mono">{p[f]}</span>;
            return <tr key={r.row_no}><td className="gd-mono" style={{ color: 'var(--mut)' }}>{r.row_no}</td><td>{cell('sku')}</td><td>{p.name}</td><td>{cell('uom')}</td><td>{cell('hsn')}</td><td>{cell('qty')}</td><td>{cell('rate')}</td></tr>; })}</tbody></table>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', background: '#f4f1e8', fontSize: 13, borderRadius: '0 0 12px 12px' }}><span style={{ color: 'var(--mut)' }}>{Math.min(6, rows.length)} of {n(c.remaining)} remaining error rows · virtualised grid, {n(c.total)} rows without paging</span><b>Commit posts 500 rows per transaction, through the same primitive the UI uses.</b></div></div>
    </div></>);
}
