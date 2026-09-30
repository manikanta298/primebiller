import React, { useEffect, useState } from 'react';
import { api, inr, lakh, qty } from '../api';

const TYPE = { DC_ISSUE: ['DC issue', 't-org'], PURCHASE: ['Purchase', 't-grn'], TRANSFER_OUT: ['Transfer out', 't-teal'], TRANSFER_IN: ['Transfer in', 't-teal'], ADJ_DOWN: ['Adjust down', 't-red'], ADJ_UP: ['Adjust up', 't-grn'] };
const STAGES = [['DRAFT', 'Draft orders'], ['CONFIRMED', 'Confirmed — stock held'], ['PARTIAL', 'Partially delivered'], ['DELIVERED', 'Delivered, not invoiced']];

export default function Dashboard({ godown }) {
  const [d, setD] = useState(null);
  useEffect(() => { api(`/dashboard?godown=${godown}`).then(setD); }, [godown]);
  if (!d) return null;
  const k = d.kpis, a = d.attention, max = Math.max(...d.byGodown.map((g) => g.value), 1) * 1.4;
  const kpi = (t, v, sub, c) => <div className="gd-card gd-kpi"><small>{t}</small><b style={{ color: c }}>{v}</b><span>{sub}</span></div>;
  const asOf = new Date(d.asOf).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return (<>
    <div className="gd-h"><div><h1>Inventory dashboard</h1><p>figures as of {asOf} IST · FY 2026-27</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="gd-btn">This month</button><button className="gd-btn pri" onClick={() => (location.hash = '/sales-orders')}>New sales order <span className="gd-kbd">Ctrl N</span></button></div></div>
    <div className="gd-kpis">
      {kpi('STOCK VALUE', `₹${lakh(k.stockValue)}`, 'Weighted average')}
      {kpi('MOVEMENTS TODAY', `₹${lakh(k.movementsValue)}`, `${k.movementDocs} documents posted`)}
      {kpi('NEAR EXPIRY', k.nearExpiry, 'Batches within 45 days', 'var(--amb)')}
      {kpi('OVER-AGED', k.overAged, 'Batches held > 180 days', 'var(--amb)')}
      {kpi('LOW STOCK', k.lowStock, 'SKUs below reorder point', 'var(--amb)')}
      {kpi('OUT OF STOCK', k.outOfStock, 'SKUs at zero free qty', 'var(--red)')}
    </div>
    <div className="gd-two">
      <div className="gd-card">
        <div className="gd-ch"><h3>Stock value by godown</h3><span className="gd-pill">{d.byGodown.length} godowns</span></div>
        {d.byGodown.map((g) => <div className="gd-gow" key={g.id}><div><span><b>{g.name}</b><small>{g.notes}</small></span><span className="gd-mono">₹{inr(g.value, 0)}</span></div><div className="gd-bar"><i style={{ width: `${g.value / max * 100}%` }} /></div></div>)}
        <div className="gd-ch" style={{ borderTop: '1px solid var(--line)' }}><h3>High-value movements today</h3><a href="#/ledger" style={{ color: 'var(--teal)', fontWeight: 600 }}>Open stock ledger</a></div>
        <table className="gd-t"><thead><tr><th>TIME</th><th>DOCUMENT</th><th>ITEM</th><th>TYPE</th><th className="gd-r">QTY</th><th className="gd-r">VALUE</th></tr></thead>
          <tbody>{d.movements.map((m) => { const [l, c] = TYPE[m.type] || [m.type, 't-teal']; return <tr key={m.doc}><td className="gd-mono">{m.time}</td><td className="gd-mono">{m.doc}</td><td>{m.item}</td><td><span className={`gd-tag ${c}`}>{l}</span></td><td className="gd-r gd-mono">{m.qty > 0 ? '+' : '−'}{qty(Math.abs(m.qty))} {m.uom}</td><td className="gd-r gd-mono">₹{inr(m.value, 0)}</td></tr>; })}</tbody></table>
      </div>
      <div className="gd-card gd-att">
        <div className="gd-ch"><h3>Needs attention</h3><span className="gd-pill" style={{ background: '#f7ecc8', color: 'var(--amb)' }}>{a.outOfStock + a.nearExpiry + a.ewbExpiring + a.overdueInvoices} open</span></div>
        <ul>{[['var(--red)', `${a.outOfStock} SKUs out of stock`, `blocking ${a.blockedOrders} confirmed SOs`, '/alerts'], ['var(--amb)', `${a.nearExpiry} batches near expiry`, 'within 45 days', '/items'], ['#a4542a', `${a.ewbExpiring} e-way bills expiring`, 'Part-B validity < 12 h', '/challans/transit'], [ 'var(--teal)', `${a.overdueInvoices} invoices overdue`, `₹${inr(a.overdueValue, 0)} receivable`, '/find']].map(([c, t, s, to]) => <li key={t}><i className="gd-dot" style={{ background: c }} /><b>{t}</b><small style={{ color: 'var(--mut)' }}>{s}</small><a href={`#${to}`}>View</a></li>)}</ul>
        <div className="gd-ch" style={{ borderTop: '1px solid var(--line)' }}><h3>Sales pipeline</h3><span className="gd-pill">FY 2026-27</span></div>
        <table className="gd-t"><thead><tr><th>STAGE</th><th className="gd-r">DOCS</th><th className="gd-r">VALUE</th></tr></thead>
          <tbody>{STAGES.map(([s, l]) => { const p = d.pipeline.find((x) => x.stage === s) || {}; return <tr key={s}><td>{l}</td><td className="gd-r gd-mono">{p.docs || 0}</td><td className="gd-r gd-mono">₹{inr(p.value || 0, 0)}</td></tr>; })}
            <tr><td>Issued, awaiting payment</td><td className="gd-r gd-mono">{d.awaiting.docs}</td><td className="gd-r gd-mono">₹{inr(d.awaiting.value, 0)}</td></tr></tbody></table>
      </div>
    </div></>);
}
