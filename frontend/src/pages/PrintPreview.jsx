import React, { useEffect, useState } from 'react';
import { api, inr } from '../api';

export default function PrintPreview() {
  const [p, setP] = useState(null), [msg, setMsg] = useState('');
  useEffect(() => { api('/print/preview').then(setP); }, []);
  if (!p) return <div className="gd-soon">Nothing to preview yet.</div>;
  const { thermal, org, invoice: v } = p;
  const dd = new Date(v.date).toLocaleDateString('en-GB').replace(/\//g, '-');
  const send = async () => { const r = await api('/print/escpos'); setMsg(`ESC/POS payload ready — ${r.bytes} bytes, base64-encoded for the driver app`); };
  return (<>
    <div className="gd-h"><div><h1>Print preview</h1><p>Profile A — 80 mm thermal at 32 characters · Profile B — A4 tax invoice</p></div>
      <div style={{ display: 'flex', gap: 10 }}><button className="gd-btn" onClick={send}>Send to counter printer</button><button className="gd-btn pri" onClick={() => window.print()}>Download PDF</button></div></div>
    {msg && <p style={{ color: 'var(--teal)' }}>{msg}</p>}
    <div className="gd-two" style={{ gridTemplateColumns: '1fr 1.55fr', alignItems: 'start' }}>
      <div className="gd-card"><div className="gd-ch"><h3>Profile A · 80 mm thermal</h3><span className="gd-tag t-org">ESC/POS · 32 char</span></div>
        <div style={{ background: '#f4f1e8', padding: 24 }}><pre className="gd-thermal">{thermal.join('\n')}</pre></div>
        <p className="gd-mono" style={{ textAlign: 'center', color: 'var(--mut)', fontSize: 12 }}>true 80 mm · character grid overlaid · 32 columns at 8.4 px</p>
        <p style={{ margin: 0, padding: '12px 16px', background: '#f4f1e8', color: 'var(--mut)', fontSize: 13 }}>Wrapping is computed against the 32-character grid, so what the counter prints is what this shows. The driver app gets the same bytes base64-encoded and sends them over Bluetooth.</p></div>
      <div className="gd-card"><div className="gd-ch"><h3>Profile B · A4 tax invoice</h3><span className="gd-tag t-teal">Rendered PDF · 1 page</span></div>
        <div style={{ background: '#f4f1e8', padding: 24 }}><div className="gd-a4">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><b style={{ fontSize: 15 }}>{org.name}</b><br /><small>{org.address}</small><br /><small className="gd-mono">GSTIN {org.gstin} · State 36 Telangana</small></div><div style={{ textAlign: 'right' }}><b>TAX INVOICE</b><br /><small>ORIGINAL FOR RECIPIENT</small></div></div><hr />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><small className="gd-cap">BILL TO</small><b>{v.party.name}</b><br /><small className="gd-mono">{v.party.gstin}</small></div>
            <table className="gd-mini">{[['Invoice no.', v.no], ['Date', dd], ['Place of supply', '36 Telangana'], ['Challans', `${v.challans} selected`], ['Reverse charge', 'No']].map(([a, b]) => <tr key={a}><td>{a}</td><td className="gd-mono">{b}</td></tr>)}</table></div>
          <table className="gd-mini" style={{ width: '100%', margin: '14px 0' }}><thead><tr><th>DESCRIPTION</th><th>HSN</th><th>QTY</th><th>UOM</th><th>RATE</th><th>TAXABLE</th><th>GST</th><th>TAX AMT</th></tr></thead>
            <tbody>{v.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.hsn}</td><td className="gd-mono">{l.qty.toFixed(3)}</td><td>{l.uom}</td><td className="gd-mono">{inr(l.rate)}</td><td className="gd-mono">{inr(l.taxable)}</td><td>{l.gst}%</td><td className="gd-mono">{inr(l.tax)}</td></tr>)}</tbody></table>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><div style={{ maxWidth: 260 }}><small className="gd-cap">AMOUNT IN WORDS</small><b style={{ fontSize: 12 }}>{v.words}</b>{v.advance && <p style={{ fontSize: 11, color: 'var(--mut)' }}>Advance {v.advance.doc_no} adjusted against this invoice.</p>}</div>
            <table className="gd-mini" style={{ minWidth: 230 }}>{[['Taxable value', v.taxable], ['CGST', v.tax / 2], ['SGST', v.tax / 2], ['Round off', 0]].map(([a, b]) => <tr key={a}><td>{a}</td><td className="gd-mono gd-r">{inr(b)}</td></tr>)}<tr><td><b>Invoice value</b></td><td className="gd-mono gd-r"><b>{inr(v.total)}</b></td></tr>{v.advance && <tr><td>Advance adjusted</td><td className="gd-mono gd-r">−{inr(v.advance.applied)}</td></tr>}<tr><td><b>Balance due</b></td><td className="gd-mono gd-r"><b>{inr(v.balance)}</b></td></tr></table></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 120, fontSize: 10, color: 'var(--mut)' }}><span>Goods once sold will not be taken back. Interest at 18% p.a. on bills outstanding past the due date. Subject to Hyderabad jurisdiction.</span><span style={{ textAlign: 'right' }}>For {org.name}<br /><br />Authorised signatory</span></div></div></div>
        <p style={{ margin: 0, padding: '12px 16px', background: '#f4f1e8', color: 'var(--mut)', fontSize: 13 }}>Rendered by a background job and stored to object storage — no headless browser on the VPS. This preview is the same component the job renders.</p></div>
    </div></>);
}
