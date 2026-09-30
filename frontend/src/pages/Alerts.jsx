import React, { useEffect, useState } from 'react';
import { api, qty } from '../api';

const SEV = { out: ['Out of stock', 't-red'], critical: ['Critical', 't-org'], low: ['Low', 't-amb'] };
const FILTERS = [['OUT_OF_STOCK', 'Out of stock'], ['BELOW_REORDER', 'Below reorder'], ['NEAR_EXPIRY', 'Near expiry'], ['OVER_AGED', 'Over-aged']];

export default function Alerts() {
  const [on, setOn] = useState(['OUT_OF_STOCK', 'BELOW_REORDER']);
  const [data, setData] = useState({ rows: [], counts: [] });
  const load = () => api(`/alerts?kinds=${on.join(',')}`).then(setData);
  useEffect(() => { load(); }, [on]);
  const n = (k) => data.counts.find((c) => c.kind === k)?.n || 0;
  const groups = [...new Set(data.rows.map((r) => r.godown))];
  const ack = async (id) => { await api(`/alerts/${id}/acknowledge`, { method: 'POST' }); load(); };
  return (<>
    <div className="gd-h"><div><h1>Stock alerts</h1><p>Refreshed by the low-stock sweep every 4 hours · last run 08:00 IST</p></div>
      <div style={{ display: 'flex', gap: 10 }}><div className="gd-chips" style={{ background: '#efece3', borderRadius: 10, padding: 3 }}>{['Warehouse', 'Supplier', 'Brand'].map((t, i) => <button key={t} className="gd-btn" style={{ border: 0, background: i ? 'none' : '#fff' }}>{t}</button>)}</div>
        <button className="gd-btn" onClick={async () => { await api('/alerts/acknowledge-all', { method: 'POST' }); load(); }}>Acknowledge all shown</button></div></div>
    <div className="gd-chips">{FILTERS.map(([k, l]) => <button key={k} className={`gd-chip${on.includes(k) ? ' on' : ''}`} onClick={() => setOn(on.includes(k) ? on.filter((x) => x !== k) : [...on, k])}>{l}<em>{k === 'BELOW_REORDER' ? n(k) : n(k)}</em></button>)}
      <span style={{ marginLeft: 'auto', color: 'var(--mut)' }}>{data.rows.length} alerts shown</span></div>
    <div className="gd-card" style={{ overflow: 'hidden', marginTop: 8 }}>
      {groups.map((g) => { const rows = data.rows.filter((r) => r.godown === g); return (<div key={g}>
        <div className="gd-gh"><span><b>{g}</b><small>{rows.length} alerts</small></span></div>
        <table className="gd-t"><thead><tr><th>ITEM</th><th>SKU</th><th className="gd-r">ON HAND</th><th className="gd-r">FREE</th><th className="gd-r">REORDER PT.</th><th className="gd-r">SHORTFALL</th><th className="gd-r">COVER</th><th>SEVERITY</th><th /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.item}</td><td className="gd-mono">{r.sku}</td><td className="gd-r gd-mono">{qty(r.on_hand)} {r.uom}</td><td className="gd-r gd-mono">{qty(r.free)} {r.uom}</td><td className="gd-r gd-mono">{qty(r.reorder_point)}</td><td className="gd-r gd-mono">−{qty(r.shortfall)}</td><td className="gd-r gd-mono">{r.cover_days} d</td><td><span className={`gd-tag ${SEV[r.severity][1]}`}>{SEV[r.severity][0]}</span></td><td><button className="gd-btn" onClick={() => ack(r.id)}>Acknowledge</button></td></tr>)}</tbody></table></div>); })}
    </div></>);
}
