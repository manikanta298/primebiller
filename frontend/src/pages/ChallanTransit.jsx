import React, { useEffect, useState } from 'react';
import { api, inr, qty } from '../api';

const H = { 'Content-Type': 'application/json' };
const fdt = (x) => new Date(x).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(' at', ',');

export default function ChallanTransit() {
  const [dc, setDc] = useState(null), [msg, setMsg] = useState('');
  const load = async () => { const cur = await api('/challans/transit/current'); if (cur) setDc(await api(`/challans/${cur.id}/transit`)); };
  useEffect(() => { load(); }, []);
  if (!dc) return <div className="gd-soon">No challan in transit.</div>;
  const act = async (path, body) => { try { await api(`/challans/${dc.id}/${path}`, { method: 'POST', headers: H, body: JSON.stringify(body || {}) }); setMsg(''); load(); } catch (e) { setMsg(e.message); } };
  const ewb = dc.ewb, left = ewb ? Math.max(0, new Date(ewb.valid_until) - Date.now()) : 0;
  const steps = [...dc.events.map((e) => ({ ...e, done: true })), ...(dc.status === 'DELIVERED' || dc.status === 'INVOICED' ? [] : [{ event: 'Proof of delivery', note: 'awaiting driver upload' }]), ...(dc.status === 'INVOICED' ? [] : [{ event: 'Invoiced', note: 'not yet converted' }])];
  const cur = dc.events.length - 1;
  const Field = ({ l, v }) => <label><small>{l}</small><input readOnly value={v || ''} /></label>;
  return (<>
    <div className="gd-h"><div><h1>Delivery challan</h1><p><b className="gd-mono" style={{ fontSize: 15, color: 'var(--ink)' }}>{dc.doc_no}</b> <span className="gd-tag t-amb">{dc.status === 'IN_TRANSIT' ? 'In transit' : dc.status[0] + dc.status.slice(1).toLowerCase()}</span><br />{msg || `${dc.customer} · ${dc.ship_to || ''} · ${dc.distance_km} km`}</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="gd-btn" onClick={() => window.print()}>Print gate pass</button><button className="gd-btn pri" disabled={dc.status !== 'IN_TRANSIT'} onClick={() => act('mark-delivered')}>Mark delivered</button></div></div>
    <div className="gd-tr3">
      <div className="gd-card"><div className="gd-ch"><h3>Status</h3></div><ol className="gd-tl">{steps.map((s, i) => <li key={i} className={s.done ? (i === cur ? 'cur' : 'done') : ''}><b>{s.event}</b><span className="gd-mono">{s.at ? `${fdt(s.at)} · ` : ''}{s.note}</span></li>)}</ol></div>
      <div className="gd-card"><div className="gd-ch"><h3>E-way bill</h3>{ewb && <span className={`gd-tag ${ewb.status === 'ACTIVE' ? 't-grn' : 't-red'}`}>{ewb.status[0] + ewb.status.slice(1).toLowerCase()}</span>}</div>
        {ewb ? <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><small className="gd-cap">EWB NUMBER</small><div className="gd-mono" style={{ fontSize: 24, fontWeight: 600 }}>{ewb.ewb_no.replace(/(\d{4})(?=\d)/g, '$1 ')}</div></div>
            <div style={{ textAlign: 'right' }}><small className="gd-cap">VALID UNTIL</small><div className="gd-mono" style={{ color: 'var(--org)', fontWeight: 600 }}>{fdt(ewb.valid_until)} IST</div><small style={{ color: 'var(--org)' }}>{Math.floor(left / 36e5)} h {Math.floor(left / 6e4) % 60} m left · one day per 200 km</small></div></div>
          <div className="gd-fields"><Field l="SUPPLY TYPE" v="Outward — supply" /><Field l="DOC TYPE" v="CHL" /><Field l="TRANSACTION TYPE" v="Regular (1)" /><Field l="PROVIDER" v={ewb.provider} />
            <Field l="VEHICLE NO. (PART-B)" v={ewb.vehicle_no} /><Field l="TRANSPORTER GSTIN" v={ewb.transporter_gstin} /><Field l="TRANSPORTER DOC NO." v={ewb.transporter_doc_no} /><Field l="DISTANCE" v={`${dc.distance_km} km`} /></div>
          <div className="gd-note gd-mono" style={{ background: '#f4f1e8', fontSize: 12 }}><small style={{ fontFamily: 'Inter' }}>GSP ROUND TRIP</small>{ewb.gsp_log}<br />idempotency-key {ewb.idempotency_key} · singleton, one per consignment<br />a retry returns this same EWB, never a second one</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="gd-btn" onClick={() => act('ewb/extend')}>Extend validity</button><button className="gd-btn" onClick={() => { const v = window.prompt('New vehicle number', ewb.vehicle_no); if (v) act('ewb/part-b', { vehicle_no: v }); }}>Update Part-B</button><button className="gd-btn" onClick={() => act('ewb/cancel')}>Cancel EWB</button><small style={{ color: 'var(--mut)' }}>Cancellation: within 24 h, if unverified in transit.</small></div></div>
          : <p style={{ padding: 16, color: 'var(--mut)' }}>No e-way bill — consignment is under the ₹50,000 threshold.</p>}</div>
      <div className="gd-card"><div className="gd-ch"><h3>Consignment</h3></div>
        <table className="gd-t"><thead><tr><th>ITEM</th><th className="gd-r">QTY</th></tr></thead><tbody>{dc.items.map((x, i) => <tr key={i}><td><b>{x.name}</b><div className="gd-mono" style={{ fontSize: 11, color: 'var(--mut)' }}>batch {x.batch_no}</div></td><td className="gd-r gd-mono">{qty(x.qty)} {x.uom}</td></tr>)}</tbody></table>
        <div style={{ padding: 16 }} className="gd-tot"><p><span>Taxable value</span><b className="gd-mono" style={{ fontWeight: 500 }}>{inr(dc.taxable)}</b></p><p><span>CGST + SGST</span><b className="gd-mono" style={{ fontWeight: 500 }}>{inr(dc.tax)}</b></p><hr /><p><b>Consignment value</b><b className="gd-mono" style={{ fontSize: 20 }}>₹{inr(dc.total)}</b></p>
          <h3 style={{ margin: '18px 0 8px' }}>Proof of delivery</h3><div className="gd-pod">Signature and photos — from the driver app</div><small style={{ color: 'var(--mut)' }}>{dc.pod_signed ? 'Signed.' : 'Nothing received yet. The mobile app queues POD offline and replays it under an idempotency key, so a retry cannot duplicate the delivery.'}</small></div></div>
    </div></>);
}
