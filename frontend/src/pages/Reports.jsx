import React, { useEffect, useState } from 'react';
import { api, inr, lakh } from '../api';
import { KpiStrip, Tag, Money } from './ScreenKit';

const monthLabel=m=>{const d=new Date(m+'-01T00:00:00');return d.toLocaleDateString('en-IN',{month:'short',year:'numeric'})};

export default function Reports(){
  const now=new Date(),initial=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const [month,setMonth]=useState(initial),[data,setData]=useState(null),[loading,setLoading]=useState(false);
  const load=()=>{setLoading(true);api('/reports?month='+month).then(setData).catch(()=>setData(null)).finally(()=>setLoading(false))};
  useEffect(()=>{load()},[month]);
  return <>
    <div className="gd-h"><div><h1>Reports &amp; GSTR-1</h1><p>Operational reports, tax summaries and filing-ready outward supply data</p></div><div className="gd-actions"><label className="gd-period"><span>PERIOD</span><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><button className="gd-btn pri" onClick={load}>{loading?'Generating…':'Generate report'}</button></div></div>
    <KpiStrip items={[
      {label:'SALES REGISTER',value:'₹'+lakh(data?.summary?.salesRegister||0),sub:'taxable value · '+monthLabel(month)},
      {label:'GST COLLECTED',value:'₹'+lakh(data?.summary?.gstCollected||0),sub:'CGST + SGST',color:'var(--teal)'},
      {label:'OPEN RECEIVABLES',value:'₹'+lakh(data?.summary?.receivables?.value||0),sub:(data?.summary?.receivables?.n||0)+' invoices outstanding',color:'var(--org)'},
      {label:'GSTR-1 STATUS',value:'REVIEW',sub:(data?.summary?.gstrExceptions||0)+' exceptions before export',color:'var(--amb)'},
    ]}/>
    <div className="gd-card-grid gd-report-grid">{(data?.reports||[]).map(r=><div className="gd-card gd-report-card" key={r.key}><div><h3>{r.title}</h3><p>{r.description}</p></div><Tag tone={r.status==='Ready'?'grn':r.status==='Needs review'?'amb':'org'}>{r.status}</Tag><button className="gd-btn">Open report</button></div>)}</div>
    <div className="gd-card gd-table-card"><div className="gd-ch"><h3>GSTR-1 - B2B outward supplies</h3><span className="gd-pill">{data?.summary?.gstrExceptions||0} exceptions · {(data?.rows||[]).length} tax invoices in period</span></div>
      <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>INVOICE</th><th>DATE</th><th>RECIPIENT</th><th>GSTIN</th><th className="gd-r">TAXABLE</th><th className="gd-r">GST</th><th>PLACE</th><th>CHECK</th></tr></thead><tbody>{(data?.rows||[]).map(r=><tr key={r.invoice_no}><td className="gd-mono"><b>{r.invoice_no}</b></td><td>{new Date(r.invoice_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</td><td>{r.recipient}</td><td className="gd-mono">{r.gstin||'—'}</td><td className="gd-r"><Money value={r.taxable}/></td><td className="gd-r"><Money value={r.gst}/></td><td>{r.godown||'—'}</td><td><Tag tone={r.checks==='Valid'?'grn':r.checks==='Review'?'amb':'red'}>{r.checks}</Tag></td></tr>)}</tbody></table></div>
      <p className="gd-footnote">Export uses the posted invoice journal and tax detail; draft documents are excluded from filing data.</p>
    </div>
  </>;
}
