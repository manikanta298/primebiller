import React, { useEffect, useState } from 'react';
import { api, inr, qty } from '../api';

const H = { 'Content-Type': 'application/json' };
const STEPS = ['Pick sales order', 'Select lines', 'Allocate batches', 'Vehicle & driver', 'Dispatch'];
const dt = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function DeliveryChallan() {
  const [dc, setDc] = useState(null), [t, setT] = useState({}), [alloc, setAlloc] = useState({}), [ewb, setEwb] = useState(false), [msg, setMsg] = useState('');
  const init = (d) => { setDc(d); setT({ vehicle_no: d.vehicle_no || '', distance_km: d.distance_km || '', driver: d.driver || '', driver_mobile: d.driver_mobile || '', transporter: d.transporter || '' });
    const a = {}; d.lines.forEach((l) => l.batches.forEach((b) => { a[b.id] = { qty: b.qty, reason: b.reason || '' }; })); setAlloc(a); };
  useEffect(() => { api('/sales-orders/current').then((so) => api(`/challans/for-so/${so.id}`)).then(init); }, []);
  if (!dc) return null;

  const rows = () => dc.lines.flatMap((l) => l.batches.filter((b) => alloc[b.id]?.qty > 0).map((b) => ({ so_line_id: l.id, item_id: l.item_id, batch_id: b.id, qty: +alloc[b.id].qty, rate: l.rate, reason: alloc[b.id].reason })));
  const save = async () => { try { const d = await api(`/challans/${dc.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ transport: t, allocations: rows() }) }); init(d); setMsg('Draft saved'); return true; } catch (e) { setMsg(e.message); return false; } };
  const setQty = (l, b, v) => {
    const oldest = l.batches.find((x) => x.free > 0), overriding = oldest && oldest.id !== b.id && v > 0;
    let reason = alloc[b.id]?.reason || '';
    if (overriding && !reason) reason = window.prompt(`Batch override: ${oldest.batch_no} is older. Reason (written to the stock ledger):`) || '';
    setAlloc({ ...alloc, [b.id]: { qty: v, reason } });
  };
  const dispatch = async () => { if (!(await save())) return; try { init(await api(`/challans/${dc.id}/dispatch`, { method: 'POST', headers: H, body: JSON.stringify({ generateEwb: ewb }) })); setMsg('Dispatched — stock posted'); } catch (e) { setMsg(e.message); } };

  const inTransit = dc.status !== 'DRAFT';
  const included = dc.lines.filter((l) => !l.excluded);
  const overridden = included.filter((l) => l.batches.some((b) => alloc[b.id]?.qty > 0 && b.fifo_qty === 0)).length;
  const val = dc.lines.reduce((s, l) => s + l.batches.reduce((a, b) => a + (+alloc[b.id]?.qty || 0), 0) * l.rate, 0);
  const total = dc.total;

  return (<>
    <div className="gd-h"><div><h1>Delivery challan</h1><p><b className="gd-mono" style={{ fontSize: 15, color: 'var(--ink)' }}>{dc.doc_no}</b> <span className="gd-tag t-amb">{inTransit ? 'In transit' : 'Draft'}</span><br />{msg || `from ${dc.so_no} · ${dc.customer}`}</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="gd-btn" onClick={save} disabled={inTransit}>Save draft <span className="gd-kbd">Ctrl S</span></button>
        <button className="gd-btn" style={{ background: 'var(--org)', color: '#fff', borderColor: 'var(--org)' }} onClick={dispatch} disabled={inTransit}>Dispatch &amp; post stock <span className="gd-kbd" style={{ color: '#000' }}>Ctrl ⏎</span></button></div></div>
    <div className="gd-card gd-steps">{STEPS.map((s, i) => <span key={s} className={i < 2 ? 'done' : i === 2 ? 'cur' : ''}><i>{i < 2 ? '✓' : i + 1}</i>{s}</span>)}<em>Partial dispatch — {included.length} of {dc.lines.length} order lines</em></div>
    <div className="gd-two" style={{ gridTemplateColumns: '1fr 330px', marginTop: 16, alignItems: 'start' }}>
      <div className="gd-card"><div className="gd-ch"><h3>Lines to dispatch</h3>{overridden > 0 && <span className="gd-tag t-org">FIFO suggested · {overridden} overridden</span>}</div>
        <table className="gd-t"><thead><tr><th>ITEM</th><th className="gd-r">ORDERED</th><th className="gd-r">ALREADY SENT</th><th className="gd-r">THIS CHALLAN</th><th className="gd-r">PENDING AFTER</th></tr></thead><tbody>
          {dc.lines.map((l) => { const mine = l.batches.reduce((a, b) => a + (+alloc[b.id]?.qty || 0), 0), pend = l.ordered - l.already_sent - mine;
            return <React.Fragment key={l.id}>
              <tr style={{ background: '#f4f1e8', opacity: l.excluded ? 0.55 : 1 }}><td><b>{l.item}</b><div className="gd-mono" style={{ fontSize: 11, color: 'var(--mut)' }}>{l.sku} · {l.godown}{l.excluded ? ' — excluded, different godown' : ''}</div></td>
                <td className="gd-r gd-mono">{qty(l.ordered)}</td><td className="gd-r gd-mono">{qty(l.already_sent)}</td><td className="gd-r gd-mono">{l.excluded ? '—' : <span className="gd-cell" style={{ display: 'inline-block', minWidth: 110 }}>{qty(mine)}</span>}</td><td className="gd-r gd-mono" style={{ color: pend > 0 && !l.excluded ? 'var(--org)' : 'inherit' }}>{qty(pend)}</td></tr>
              {l.batches.map((b) => { const v = alloc[b.id]?.qty || 0, oldest = l.batches.find((x) => x.free > 0);
                const tag = v > 0 ? (b.fifo_qty > 0 ? <span className="gd-tag t-grn">FIFO — oldest first</span> : <span className="gd-tag t-org">Manual override</span>) : b.id === oldest?.id && l.batches.some((x) => alloc[x.id]?.qty > 0) ? <small style={{ color: 'var(--mut)' }}>FIFO would take this first</small> : <small style={{ color: 'var(--mut)' }}>not needed</small>;
                return <tr key={b.id}><td className="gd-mono" style={{ paddingLeft: 28 }}>{b.batch_no}</td><td style={{ color: 'var(--mut)' }}>Mfg {dt(b.mfg_date)}</td><td className="gd-r gd-mono">{qty(b.free)}</td>
                  <td className="gd-r"><input className="gd-cell gd-mono" disabled={inTransit} value={v} onChange={(e) => setQty(l, b, Math.min(+e.target.value || 0, b.free))} /></td><td>{tag}</td></tr>; })}
            </React.Fragment>; })}</tbody></table>
        {dc.lines.some((l) => l.batches.some((b) => alloc[b.id]?.reason)) && <div className="gd-note" style={{ background: '#f7ecd0', margin: 0, borderRadius: '0 0 12px 12px' }}><b>Batch override</b> — the reason is written onto the stock ledger entry.</div>}
      </div>
      <div className="gd-card gd-tp"><div className="gd-ch"><h3>Transport</h3></div><div style={{ padding: 16 }}>
        {[['VEHICLE NO.', 'vehicle_no'], ['DISTANCE (KM)', 'distance_km'], ['DRIVER', 'driver'], ['MOBILE', 'driver_mobile'], ['TRANSPORTER', 'transporter']].map(([l, k]) => <label key={k}><small>{l}</small><input disabled={inTransit} value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>)}
        <hr /><small style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>E-WAY BILL THRESHOLD</small>
        <p style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0' }}>Consignment value<b className="gd-mono" style={{ fontSize: 17 }}>₹{inr(total || val)}</b></p>
        <div style={{ height: 6, background: total > 50000 ? 'var(--org)' : 'var(--teal)', borderRadius: 3 }} />
        {total > 50000 && <p style={{ color: 'var(--org)', fontWeight: 600 }}>Over the ₹50,000 threshold — an e-way bill is mandatory before the vehicle moves.</p>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={ewb || !!dc.ewb} disabled={inTransit} onChange={(e) => setEwb(e.target.checked)} />Generate the e-way bill on dispatch</label>
        {dc.ewb && <p className="gd-mono" style={{ fontSize: 13 }}>EWB {dc.ewb.ewb_no.replace(/(\d{4})(?=\d)/g, '$1 ')}</p>}
        <hr /><p style={{ display: 'flex', justifyContent: 'space-between' }}><span>Taxable value</span><b className="gd-mono">{inr(dc.taxable)}</b></p><p style={{ display: 'flex', justifyContent: 'space-between' }}><span>CGST + SGST</span><b className="gd-mono">{inr(dc.tax)}</b></p>
        <p style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--ink)', paddingTop: 10 }}><b>Challan value</b><b className="gd-mono" style={{ fontSize: 20 }}>₹{inr(total)}</b></p></div></div>
    </div></>);
}
