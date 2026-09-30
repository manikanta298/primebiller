import React, { useEffect, useState } from 'react';
import { api, inr, qty } from '../api';

const TAG = { 'FIFO next': 't-teal', Expired: 't-red', 'Near expiry': 't-amb', 'Over-aged': 't-amb' };
const fd = (x) => (x ? new Date(x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const TABS = ['General', 'Tax', 'Units', 'Per godown', 'Batches'];

export default function ItemDetail() {
  const [d, setD] = useState(null), [flt, setFlt] = useState('all');
  useEffect(() => { api('/items/current').then((c) => c && api(`/items/${c.id}/detail`)).then(setD); }, []);
  if (!d) return null;
  const { item, kpis: k, batches, uoms, settings } = d;
  const near = batches.filter((b) => b.near).length, over = batches.filter((b) => b.age > 180).length;
  const shown = batches.filter((b) => flt === 'all' || (flt === 'near' && b.near) || (flt === 'over' && b.age > 180));
  const kpi = (t, v, s) => <div className="gd-card gd-kpi" style={{ flex: 1 }}><small>{t}</small><b>{v}</b><span>{s}</span></div>;
  return (<>
    <div className="gd-h"><div><h1>{item.name}</h1><p className="gd-mono" style={{ fontSize: 13 }}>{item.sku} · {item.brand} · {item.category} · HSN {item.hsn} · GST {item.gst_rate}% · {item.batch_tracked ? 'batch tracked' : 'untracked'}, {item.valuation}</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="gd-btn" onClick={() => (location.hash = '/ledger')}>Stock ledger</button><button className="gd-btn pri">Edit item</button></div></div>
    <div className="gd-tabs">{TABS.map((t) => <span key={t} className={t === 'Batches' ? 'on' : ''}>{t}</span>)}<em>{batches.length} open batches · {near} near expiry</em></div>
    <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
      {kpi('ON HAND', qty(k.on_hand), `${item.base_uom} across ${k.godowns} godowns`)}{kpi('RESERVED', qty(k.reserved), 'held by confirmed orders')}{kpi('FREE', qty(k.free), 'available to promise')}
      {kpi('VALUATION', `₹${inr(k.valuation, 0)}`, `weighted average ₹${inr(k.wavg)} / ${item.base_uom}`)}{kpi('COVER', k.cover ? `${k.cover} d` : '—', 'at the last 30-day run rate')}</div>
    <div className="gd-two" style={{ gridTemplateColumns: '1fr 345px', alignItems: 'start' }}>
      <div className="gd-card"><div className="gd-ch"><h3>Batches</h3><div className="gd-chips">{[['all', `All ${batches.length}`], ['near', `Near expiry ${near}`], ['over', `Over-aged ${over}`]].map(([v, l]) => <button key={v} className={`gd-chip${flt === v ? ' on' : ''}`} onClick={() => setFlt(v)}>{l}</button>)}</div></div>
        <div style={{ overflowX: 'auto' }}><table className="gd-t"><thead><tr><th>BATCH</th><th>GODOWN</th><th>MANUFACTURED</th><th>EXPIRES</th><th className="gd-r">AGE</th><th className="gd-r">ON HAND</th><th className="gd-r">FREE</th><th className="gd-r">RATE</th><th /></tr></thead>
          <tbody>{shown.map((b) => <tr key={b.id}><td className="gd-mono">{b.batch_no}</td><td>{b.godown}</td><td>{fd(b.mfg_date)}</td><td>{fd(b.expiry_date)}</td><td className="gd-r gd-mono">{b.age} d</td><td className="gd-r gd-mono">{qty(b.qty_on_hand)}</td><td className="gd-r gd-mono">{qty(b.free)}</td><td className="gd-r gd-mono">{inr(b.unit_cost)}</td><td>{b.tag && <span className={`gd-tag ${TAG[b.tag]}`}>{b.tag}</span>}</td></tr>)}</tbody></table></div>
        <p style={{ margin: 0, padding: '10px 16px', background: '#f4f1e8', color: 'var(--mut)', fontSize: 13, borderRadius: '0 0 12px 12px' }}>Expired and over-aged batches stay on the ledger. They are left out of the FIFO suggestion but can still be picked by hand, with the reason recorded.</p></div>
      <div>
        <div className="gd-card"><div className="gd-ch"><h3>Units of measure</h3></div><table className="gd-t"><thead><tr><th>UOM</th><th>FORMULA</th><th className="gd-r">TO BASE</th></tr></thead><tbody>{uoms.map((u) => <tr key={u.uom}><td><b>{u.uom}</b></td><td>{u.formula}</td><td className="gd-r gd-mono">{Number(u.to_base).toFixed(6)}</td></tr>)}</tbody></table>
          <div className="gd-ch" style={{ borderTop: '1px solid var(--line)' }}><h3>Per-godown settings</h3></div>
          <table className="gd-t"><thead><tr><th>GODOWN</th><th className="gd-r">REORDER</th><th className="gd-r">MAX</th><th>NEGATIVE</th></tr></thead><tbody>{settings.map((s) => <tr key={s.godown}><td>{s.godown.split(' ')[0]}</td><td className="gd-r gd-mono">{qty(s.reorder)}</td><td className="gd-r gd-mono">{qty(s.max)}</td><td><span className={`gd-tag ${s.allow_negative ? 't-amb' : 't-grn'}`}>{s.allow_negative ? 'Allowed' : 'Blocked'}</span></td></tr>)}</tbody></table>
          <div className="gd-note" style={{ background: '#f4f1e8', margin: 0, borderRadius: '0 0 12px 12px' }}><small style={{ color: 'var(--mut)' }}>ENFORCEMENT</small>Negative stock is refused by a database CHECK constraint, not by application code. Shop Counter carries an explicit exception, recorded on the warehouse.</div></div></div>
    </div></>);
}
