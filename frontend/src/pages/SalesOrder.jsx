import React, { useEffect, useRef, useState } from 'react';
import { api, inr, qty } from '../api';

const calc = (l) => { const g = l.qty * l.rate, t = +(g * (1 - (l.disc_pct || 0) / 100)).toFixed(2); return { g, t, a: +(t * (1 + l.gst_pct / 100)).toFixed(2) }; };

export default function SalesOrder() {
  const [so, setSo] = useState(null), [lines, setLines] = useState([]), [msg, setMsg] = useState(''), [pick, setPick] = useState({ q: '', rows: [] });
  const [parties, setParties] = useState([]), [gow, setGow] = useState([]);
  const searchRef = useRef();
  const load = async () => { const cur = await api('/sales-orders/current'); if (!cur) return; const d = await api(`/sales-orders/${cur.id}`); setSo(d); setLines(d.lines); };
  useEffect(() => { load(); api('/warehouses').then(setGow); }, []);
  useEffect(() => { if (pick.q.length > 1) { const t = setTimeout(() => api(`/items/search?q=${encodeURIComponent(pick.q)}&godown=${so?.warehouse_id || 0}`).then((rows) => setPick((p) => ({ ...p, rows }))), 120); return () => clearTimeout(t); } }, [pick.q]);
  if (!so) return <div className="gd-soon">No open sales order.</div>;

  const set = (k, v) => setSo({ ...so, [k]: v });
  const T = lines.reduce((a, l) => { const c = calc(l); a.g += c.g; a.t += c.t; a.tax += c.a - c.t; return a; }, { g: 0, t: 0, tax: 0 });
  const half = T.tax / 2, total = T.t + T.tax, headroom = so.credit.limit - so.credit.outstanding - total;
  const upd = (i, k, v) => setLines(lines.map((l, x) => (x === i ? { ...l, [k]: v } : l)));
  const body = () => ({ party_id: so.party_id, order_date: so.order_date, ship_to: so.ship_to, warehouse_id: so.warehouse_id, terms: so.terms, lines });
  const save = async () => { try { const d = await api(`/sales-orders/${so.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) }); setSo(d); setLines(d.lines); setMsg('Draft saved'); } catch (e) { setMsg(e.message); } };
  const confirm = async (ownerOverride) => {
    await save();
    try { await api(`/sales-orders/${so.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerOverride }) }); location.hash = '/challans'; }
    catch (e) { if (/Owner override/.test(e.message) && window.confirm(`${e.message}. Apply Owner override and confirm?`)) confirm(true); else setMsg(e.message); }
  };
  const addItem = (it) => { setLines([...lines, { item_id: it.id, item: it.name, sku: it.sku, hsn: it.hsn, on_hand: it.on_hand, free: it.free, warehouse_id: so.warehouse_id, godown: gow.find((g) => g.id === so.warehouse_id)?.name.split(' ')[0], qty: 1, uom: it.uom, rate: 0, disc_pct: 0, gst_pct: it.gst_rate }]); setPick({ q: '', rows: [] }); };

  return (<>
    <div className="gd-h"><div><h1>Sales order</h1><p><b className="gd-mono" style={{ fontSize: 15, color: 'var(--ink)' }}>{so.doc_no}</b> <span className="gd-tag t-amb" style={{ background: '#efece3', color: 'var(--mut)' }}>{so.status === 'DRAFT' ? 'Draft' : so.status}</span><br />{msg || `autosaved · ${so.customer}`}</p></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="gd-btn" style={{ border: 0, background: 'none' }} onClick={load}>Discard</button>
        <button className="gd-btn" onClick={save}>Save draft <span className="gd-kbd">Ctrl S</span></button><button className="gd-btn pri" disabled={so.status !== 'DRAFT'} onClick={() => confirm(false)}>Confirm &amp; hold stock <span className="gd-kbd" style={{ color: '#000' }}>Ctrl ⏎</span></button></div></div>
    <div className="gd-card gd-so-head">
      {[['CUSTOMER', <input value={so.customer} readOnly />], ['GSTIN', <input className="gd-mono" value={so.gstin || 'unregistered'} readOnly style={{ background: '#efece3' }} />],
        ['ORDER DATE', <input type="date" value={so.order_date?.slice(0, 10)} onChange={(e) => set('order_date', e.target.value)} />], ['SHIP-TO', <input value={so.ship_to || ''} onChange={(e) => set('ship_to', e.target.value)} />],
        ['GODOWN', <select value={so.warehouse_id} onChange={(e) => set('warehouse_id', +e.target.value)}>{gow.map((g) => <option key={g.id} value={g.id}>{g.name.split(' ')[0]}</option>)}</select>], ['TERMS', <input value={so.terms || ''} onChange={(e) => set('terms', e.target.value)} />]].map(([l, c]) => <label key={l}><small>{l}</small>{c}</label>)}
    </div>
    <div className="gd-two" style={{ gridTemplateColumns: '1fr 290px', marginTop: 16, alignItems: 'start' }}>
      <div className="gd-card" style={{ overflow: 'visible' }}>
        <div className="gd-ch"><h3>Lines · {lines.length}</h3><span style={{ color: 'var(--mut)', fontSize: 12 }}><span className="gd-kbd">Tab</span> next field &nbsp;<span className="gd-kbd">⏎</span> new line &nbsp;<span className="gd-kbd">Ctrl D</span> duplicate &nbsp;<span className="gd-kbd">Alt W</span> godown</span></div>
        <div style={{ overflowX: 'auto' }}><table className="gd-t"><thead><tr><th>#</th><th>ITEM / SKU</th><th>AVAILABILITY</th><th>GODOWN</th><th className="gd-r">QTY</th><th>UOM</th><th className="gd-r">RATE</th><th className="gd-r">DISC %</th><th className="gd-r">GST %</th><th className="gd-r">TAXABLE</th><th className="gd-r">AMOUNT</th></tr></thead>
          <tbody>{lines.map((l, i) => { const c = calc(l); const short = l.free < l.qty; return <tr key={i}><td className="gd-mono">{i + 1}</td>
            <td><b>{l.item}</b><div className="gd-mono" style={{ color: 'var(--mut)', fontSize: 11 }}>{l.sku} · HSN {l.hsn}</div></td>
            <td className="gd-mono" style={{ fontSize: 12 }}>on hand {qty(l.on_hand)} | <b style={{ color: short ? 'var(--red)' : 'var(--teal)' }}>free {qty(l.free)}</b></td><td>{l.godown}</td>
            <td className="gd-r"><input className="gd-cell gd-mono" value={l.qty} onChange={(e) => upd(i, 'qty', +e.target.value || 0)} /></td><td><b>{l.uom}</b></td>
            <td className="gd-r"><input className="gd-cell gd-mono" value={l.rate} onChange={(e) => upd(i, 'rate', +e.target.value || 0)} /></td>
            <td className="gd-r"><input className="gd-cell gd-mono" value={l.disc_pct} onChange={(e) => upd(i, 'disc_pct', +e.target.value || 0)} /></td>
            <td className="gd-r gd-mono">{l.gst_pct}</td><td className="gd-r gd-mono">{inr(c.t)}</td><td className="gd-r gd-mono">{inr(c.a)}</td></tr>; })}
            <tr style={{ background: '#e4eeeb' }}><td className="gd-mono">{lines.length + 1}</td><td colSpan={10} style={{ position: 'relative' }}>
              <input ref={searchRef} className="gd-pick" placeholder="pick an item — type to search" value={pick.q} onChange={(e) => setPick({ q: e.target.value, rows: [] })} />
              {pick.rows.length > 0 && <div className="gd-sug" style={{ width: 460 }}><small>MATCHING “{pick.q.toUpperCase()}”</small>{pick.rows.map((it) => <div key={it.id} onClick={() => addItem(it)}><span><b>{it.name}</b><br /><span className="gd-mono" style={{ fontSize: 11, color: 'var(--mut)' }}>{it.sku} · HSN {it.hsn} · GST {it.gst_rate}%</span></span><span className="gd-mono" style={{ fontSize: 12 }}>on hand {qty(it.on_hand)} | <b style={{ color: it.free > 0 ? 'var(--teal)' : 'var(--red)' }}>free {qty(it.free)} {it.uom}</b></span></div>)}</div>}</td></tr></tbody></table></div>
      </div>
      <div>
        <div className="gd-card gd-tot"><small>ORDER TOTALS</small>
          {[['Gross', T.g], ['Discount', -(T.g - T.t)], ['Taxable value', T.t]].map(([l, v]) => <p key={l}><span>{l}</span><b className="gd-mono">{inr(v)}</b></p>)}<hr />
          {[['CGST', so.intra ? half : 0], ['SGST', so.intra ? half : 0], ['IGST', so.intra ? 0 : T.tax], ['Round off', 0]].map(([l, v]) => <p key={l}><span>{l}</span><b className="gd-mono" style={{ color: v ? 'inherit' : 'var(--mut)' }}>{inr(v)}</b></p>)}<hr />
          <p><b style={{ fontSize: 15 }}>Order value</b><b className="gd-mono" style={{ fontSize: 20 }}>₹{inr(total)}</b></p>
          <div className="gd-note" style={{ background: '#dfeceb' }}><small>SUPPLY DETERMINATION</small>{so.intra ? 'Intra-state — supplier 36 Telangana, place of supply 36 Telangana. CGST + SGST applies.' : 'Inter-state — IGST applies.'}</div>
          <div className="gd-note" style={{ background: '#f7ecd0' }}><small>CREDIT CHECK</small>Limit ₹{inr(so.credit.limit, 0)} · outstanding ₹{inr(so.credit.outstanding, 0)} · this order ₹{inr(total)}. {headroom < 0 ? `Confirming exceeds the limit by ₹${inr(-headroom)} — an Owner override is required.` : `Confirming leaves ₹${inr(headroom)} headroom.`}</div></div>
      </div>
    </div></>);
}
