import React, { useEffect, useState } from 'react';
import { api, inr } from '../api';

const TYPES = [['SO', 'Sales order'], ['DC', 'Delivery challan'], ['INV', 'Tax invoice'], ['RCT', 'Advance receipt']];
const STATUS = [['PENDING', 'Pending'], ['PARTIAL', 'Partially delivered'], ['COMPLETED', 'Completed'], ['OVERDUE', 'Overdue']];
const PERIODS = [['TODAY', 'Today'], ['YESTERDAY', 'Yesterday'], ['THIS_WEEK', 'This week'], ['THIS_MONTH', 'This month'], ['THIS_FY', 'This FY']];
const TL = { SO: 'Sales order', DC: 'Delivery challan', INV: 'Tax invoice', RCT: 'Advance receipt' };
const TC = { SO: 't-teal', DC: 't-org', INV: 't-teal', RCT: 't-grn' };
const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function FindDocument() {
  const [f, setF] = useState({ q: '', docTypes: ['DC', 'INV'], statuses: ['OVERDUE'], datePreset: 'THIS_MONTH', amountFrom: '', amountTo: '', sort: 'date_desc' });
  const [res, setRes] = useState({ rows: [], total: 0, facets: [] });
  const [sug, setSug] = useState([]);
  const tog = (key, v) => setF((s) => ({ ...s, [key]: s[key].includes(v) ? s[key].filter((x) => x !== v) : [...s[key], v] }));
  const qs = new URLSearchParams({ q: f.q, docTypes: f.docTypes, statuses: f.statuses, datePreset: f.datePreset, amountFrom: f.amountFrom, amountTo: f.amountTo, sort: f.sort });
  [...qs.keys()].forEach((k) => !qs.get(k) && qs.delete(k));
  useEffect(() => { const t = setTimeout(() => api(`/search?${qs}`).then(setRes), 150); return () => clearTimeout(t); }, [qs.toString()]);
  useEffect(() => { f.q.length > 1 ? api(`/parties/suggest?q=${encodeURIComponent(f.q)}`).then(setSug) : setSug([]); }, [f.q]);
  const fac = (k) => res.facets.find((x) => x.k === k)?.n || 0;
  const Chips = ({ label, list, key2, count }) => <div className="gd-chips"><small style={{ width: 80, color: 'var(--mut)', letterSpacing: '.06em' }}>{label}</small>{list.map(([k, l]) => <button key={k} className={`gd-chip${f[key2] === k || (Array.isArray(f[key2]) && f[key2].includes(k)) ? ' on' : ''}`} onClick={() => Array.isArray(f[key2]) ? tog(key2, k) : setF({ ...f, [key2]: k })}>{l}{count && <em>{count(k)}</em>}</button>)}</div>;
  return (<>
    <div className="gd-h"><div><h1>Find a document</h1><p>One query across sales orders, challans, invoices and advance receipts — filters stay in the URL</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="gd-btn">Save this view</button><button className="gd-btn">Export CSV</button></div></div>
    <div className="gd-card"><div className="gd-form">
      <label><small>QUERY</small><input className="focus" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        {sug.length > 0 && <div className="gd-sug"><small>CUSTOMERS — TRIGRAM MATCH</small>{sug.map((p) => <div key={p.id} onClick={() => setF({ ...f, q: p.name })}><b>{p.name} <span className="gd-mono" style={{ color: 'var(--mut)', fontWeight: 400 }}>{p.gstin || 'unregistered'}</span></b><span className="gd-mono">{p.mobile}</span></div>)}</div>}</label>
      <label><small>AMOUNT FROM</small><input value={f.amountFrom} onChange={(e) => setF({ ...f, amountFrom: e.target.value })} /></label>
      <label><small>AMOUNT TO</small><input value={f.amountTo} onChange={(e) => setF({ ...f, amountTo: e.target.value })} /></label>
      <label><small>SORT</small><select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="date_desc">Date, newest first</option><option value="date_asc">Date, oldest first</option><option value="amount_desc">Amount, high to low</option></select></label>
    </div>
    <div style={{ padding: '0 16px' }}>
      <Chips label="DOC TYPE" list={TYPES} key2="docTypes" count={fac} /><Chips label="STATUS" list={STATUS} key2="statuses" /><Chips label="PERIOD" list={PERIODS} key2="datePreset" />
    </div><span className="gd-url">/search?{qs.toString()}</span></div>
    <div className="gd-card" style={{ marginTop: 16, overflow: 'hidden' }}>
      <div className="gd-ch"><h3>{res.total} documents</h3><span style={{ color: 'var(--mut)' }}>Showing 1–{res.rows.length} · cursor paged, 50 per fetch</span></div>
      <table className="gd-t"><thead><tr><th>DOCUMENT</th><th>TYPE</th><th>DATE</th><th>CUSTOMER</th><th>GODOWN</th><th className="gd-r">AMOUNT</th><th className="gd-r">BALANCE DUE</th><th>STATUS</th></tr></thead>
        <tbody>{res.rows.map((r) => <tr key={r.doc_no}><td className="gd-mono">{r.doc_no}</td><td><span className={`gd-tag ${TC[r.doc_type]}`}>{TL[r.doc_type]}</span></td><td>{fmt(r.doc_date)}</td><td>{r.customer}</td><td>{r.godown}</td><td className="gd-r gd-mono">₹{inr(r.amount)}</td><td className="gd-r gd-mono">{r.doc_type === 'INV' && r.balance_due ? `₹${inr(r.balance_due)}` : '—'}</td>
          <td>{r.status === 'OVERDUE' ? <span className="gd-tag t-red">Overdue {r.overdue_days} d</span> : r.status === 'IN_TRANSIT' ? <span className="gd-tag t-amb">In transit</span> : <span className="gd-tag t-grn">{r.status[0] + r.status.slice(1).toLowerCase().replace('_', ' ')}</span>}</td></tr>)}</tbody></table>
    </div></>);
}
