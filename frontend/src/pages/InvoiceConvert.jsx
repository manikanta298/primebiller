import React, { useEffect, useState } from 'react';
import { api, inr } from '../api';

const H = { 'Content-Type': 'application/json' };
const d = (x) => new Date(x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function InvoiceConvert() {
  const [ctx, setCtx] = useState(null), [sel, setSel] = useState([]), [adv, setAdv] = useState({}), [pv, setPv] = useState(null), [msg, setMsg] = useState('');
  useEffect(() => { api('/invoicing/context').then((c) => { setCtx(c); if (!c) return; setSel(c.challans.slice(0, 2).map((x) => x.id)); const a = {}; let left = 100000; c.advances.forEach((x) => { const t = Math.min(left, x.unadjusted); a[x.id] = left > 0 && x === c.advances[0] ? t : 0; left -= a[x.id]; }); setAdv(a); }); }, []);
  const advList = ctx ? ctx.advances.map((x) => ({ receiptId: x.id, amount: adv[x.id] || 0 })) : [];
  useEffect(() => { if (ctx) api('/invoicing/preview', { method: 'POST', headers: H, body: JSON.stringify({ challanIds: sel, advances: advList }) }).then(setPv); }, [sel, JSON.stringify(adv)]);
  if (!ctx) return <div className="gd-soon"><h1>Convert challans to a tax invoice</h1><p>No delivered challans are waiting to be invoiced.</p></div>;
  if (!pv) return null;

  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const toggleAdv = (a) => setAdv({ ...adv, [a.id]: adv[a.id] > 0 ? 0 : a.unadjusted });
  const issue = async () => {
    try { const r = await api('/invoices', { method: 'POST', headers: H, body: JSON.stringify({ partyId: ctx.party.id, challanIds: sel, advances: advList }) }); setMsg(`Issued ${r.docNo}`); const c = await api('/invoicing/context'); setCtx(c); setSel([]); setAdv({}); }
    catch (e) { setMsg(e.message); }
  };
  return (<>
    <div className="gd-h"><div><h1>Convert challans to a tax invoice</h1><p>{msg || <>{ctx.party.name} · {ctx.party.gstin} · next number <span className="gd-mono">{ctx.nextNo}</span></>}</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="gd-btn" onClick={() => (location.hash = '/print')}>Preview</button><button className="gd-btn">Save draft <span className="gd-kbd">Ctrl S</span></button>
        <button className="gd-btn pri" onClick={issue} disabled={!sel.length}>Issue invoice <span className="gd-kbd" style={{ color: '#000' }}>Ctrl ⏎</span></button></div></div>
    <div className="gd-two" style={{ gridTemplateColumns: '1fr 330px', alignItems: 'start' }}>
      <div>
        <div className="gd-card"><div className="gd-ch"><h3>Delivered challans, not yet invoiced</h3><span className="gd-pill" style={{ background: '#d5e8e4', color: 'var(--teal)' }}>{sel.length} of {ctx.challans.length} selected</span></div>
          {ctx.challans.map((c) => <label key={c.id} className="gd-pick-row" style={{ background: sel.includes(c.id) ? '#e4eeeb' : '#fff' }}><input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />
            <b className="gd-mono">{c.doc_no}</b><span>{d(c.challan_date)}</span><span style={{ flex: 1 }}>{c.lines} lines · {c.godown}{c.pod_signed ? ' · POD signed' : ' · POD pending'}</span><b className="gd-mono">₹{inr(c.total)}</b></label>)}</div>
        <div className="gd-card" style={{ marginTop: 16 }}><div className="gd-ch"><h3>Unadjusted advances — oldest first</h3><span style={{ color: 'var(--mut)' }}>₹{inr(ctx.available)} available</span></div>
          <table className="gd-t"><thead><tr><th /><th>RECEIPT</th><th>DATE</th><th>MODE</th><th className="gd-r">UNADJUSTED</th><th className="gd-r">APPLY</th></tr></thead>
            <tbody>{ctx.advances.map((a) => <tr key={a.id} style={{ background: adv[a.id] > 0 ? '#e4eeeb' : undefined }}><td><input type="checkbox" checked={adv[a.id] > 0} onChange={() => toggleAdv(a)} /></td><td className="gd-mono"><b>{a.doc_no}</b></td><td>{d(a.receipt_date)}</td><td>{a.mode}</td>
              <td className="gd-r gd-mono">{inr(a.unadjusted)}</td><td className="gd-r gd-mono" style={{ color: adv[a.id] > 0 ? 'var(--teal)' : 'var(--mut)' }}>{inr(adv[a.id] || 0)}</td></tr>)}</tbody></table>
          <p style={{ margin: 0, padding: '10px 16px', background: '#f4f1e8', color: 'var(--mut)', fontSize: 13, borderRadius: '0 0 12px 12px' }}>Applying an advance writes a receipt allocation and reverses the advance-tax liability declared in the month the money came in.</p></div>
      </div>
      <div className="gd-card gd-tot" style={{ minHeight: 560, display: 'flex', flexDirection: 'column' }}><h3 style={{ margin: '0 0 12px' }}>Tax summary</h3>
        <table className="gd-t" style={{ marginBottom: 8 }}><thead><tr><th style={{ background: 'none', padding: 0 }}>RATE</th><th className="gd-r" style={{ background: 'none' }}>TAXABLE</th><th className="gd-r" style={{ background: 'none' }}>TAX</th></tr></thead>
          <tbody>{pv.rates.map((x) => <tr key={x.rate} style={{ color: x.taxable ? 'inherit' : 'var(--mut)' }}><td style={{ padding: '4px 0', border: 0, background: 'none' }}>{x.rate}%</td><td className="gd-r gd-mono" style={{ border: 0, background: 'none', padding: 4 }}>{inr(x.taxable)}</td><td className="gd-r gd-mono" style={{ border: 0, background: 'none', padding: 4 }}>{inr(x.tax)}</td></tr>)}</tbody></table><hr />
        {[['Taxable value', pv.taxable], ['CGST', pv.cgst], ['SGST', pv.sgst], ['Round off', 0]].map(([l, v]) => <p key={l}><span>{l}</span><b className="gd-mono" style={{ fontWeight: 500 }}>{inr(v)}</b></p>)}<hr />
        <p><b style={{ fontSize: 15 }}>Invoice value</b><b className="gd-mono" style={{ fontSize: 20 }}>₹{inr(pv.total)}</b></p><hr />
        <p><span>Advance adjusted</span><b className="gd-mono" style={{ color: 'var(--teal)' }}>−{inr(pv.advanceAdjusted)}</b></p><hr />
        <p><b style={{ fontSize: 15 }}>Balance due</b><b className="gd-mono" style={{ fontSize: 20, color: 'var(--org)' }}>₹{inr(pv.balanceDue)}</b></p>
        <div className="gd-note" style={{ background: '#efece3', marginTop: 'auto' }}><small style={{ color: 'var(--mut)' }}>ON ISSUE</small>The number comes from a locked counter row — gapless within FY 2026-27, as GST Rule 46(b) requires. Journal entry, receipt allocation and challan links all post in one transaction.</div></div>
    </div></>);
}
