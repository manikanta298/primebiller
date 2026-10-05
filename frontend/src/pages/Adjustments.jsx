import React, { useEffect, useState } from 'react';
import { api, inr, lakh, qty } from '../api';
import { KpiStrip, FilterBar, Tag, dateShort } from './ScreenKit';

export default function Adjustments(){
  const [data,setData]=useState(null),[status,setStatus]=useState(''),[sel,setSel]=useState(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
  const load=()=>api('/adjustments?status='+status).then(d=>{setData(d);if(sel){const next=(d.rows||[]).find(x=>x.id===sel.id);setSel(next||null)}}).catch(()=>setData({rows:[],summary:{}}));
  useEffect(()=>{load()},[status]);
  const act=async(action)=>{if(!sel)return;setBusy(true);try{await api('/adjustments/'+sel.id+'/'+action,{method:'POST'});setMsg(action==='approve'?'Approved & posted':'Rejected');await load()}catch(e){setMsg(e.message)}finally{setBusy(false)}};
  const s=data?.summary||{};
  return <>
    <div className="gd-h"><div><h1>Stock adjustments</h1><p>Controlled corrections for counts, damage, expiry and opening balance exceptions</p></div><div className="gd-actions"><button className="gd-btn">Export CSV</button><button className="gd-btn pri">New adjustment</button></div></div>
    <KpiStrip items={[
      {label:'PENDING APPROVAL',value:s.pending?.n||0,sub:'₹'+inr(s.pending?.value||0,0)+' value at risk',color:'var(--org)'},
      {label:'POSTED THIS MONTH',value:s.month?.n||0,sub:'increases + decreases'},
      {label:'INCREASED VALUE',value:'₹'+lakh(s.increased?.value||0),sub:'posted adjustments',color:'var(--teal)'},
      {label:'DECREASED VALUE',value:'₹'+lakh(s.decreased?.value||0),sub:'posted adjustments',color:'var(--red)'},
    ]}/>
    <div className="gd-two gd-list-split"><div>
      <FilterBar><div className="gd-filter-row"><label className="gd-grow"><span>Search adjustment no. / item</span><input placeholder="ADJ/25-26/00011"/></label><label><span>Reason</span><select><option>All</option><option>Physical count</option><option>Damaged sheet</option></select></label><label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option><option value="PENDING">Pending</option><option value="POSTED">Posted</option><option value="REJECTED">Rejected</option></select></label><label><span>Godown</span><select><option>Balanagar</option></select></label></div></FilterBar>
      <div className="gd-card gd-table-card"><div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>DOC DATE</th><th>GODOWN</th><th>REASON</th><th className="gd-r">QTY</th><th className="gd-r">VALUE</th><th>STATUS</th></tr></thead><tbody>{(data?.rows||[]).map(r=><tr key={r.id} className="gd-row-link" onClick={()=>{setSel(r);setMsg('')}}><td><b className="gd-mono">{r.doc_no}</b><small>{dateShort(r.adjustment_date)}</small></td><td>{r.godown.split(' ')[0]}</td><td>{r.reason}<small>{r.item}</small></td><td className="gd-r gd-mono">{r.qty>0?'+':''}{qty(r.qty)} {r.uom}</td><td className="gd-r gd-mono">{r.value<0?'−':'+'}₹{inr(Math.abs(r.value),0)}</td><td><Tag tone={r.status==='PENDING'?'org':r.status==='POSTED'?'grn':'red'}>{r.status==='PENDING'?'Pending':r.status==='POSTED'?'Posted':'Rejected'}</Tag></td></tr>)}</tbody></table></div></div>
    </div>
    <div className="gd-card gd-side-panel"><div className="gd-ch"><h3>Approval detail</h3></div>{sel?<div className="gd-detail-pad">
      <div className="gd-timeline"><div className="done"><b>Adjustment submitted</b><span>{dateShort(sel.adjustment_date)} · {sel.submitted_by||'Harish K.'}</span></div><div className="done"><b>Count variance recorded</b><span>{sel.item} · {sel.qty} {sel.uom} · ₹{inr(Math.abs(sel.value),0)}</span></div><div className={sel.status==='PENDING'?'cur':''}><b>{sel.status==='PENDING'?'Awaiting owner approval':sel.status}</b><span>{sel.reason}</span></div></div>
      {sel.status==='PENDING'?<><div className="gd-note" style={{background:'#f7ecd0'}}>Reason is required before posting a negative adjustment. Posting creates one stock-ledger entry and keeps the adjustment reason attached to the ledger audit trail.</div><div className="gd-actions"><button className="gd-btn" disabled={busy} onClick={()=>act('reject')}>Reject</button><button className="gd-btn pri" disabled={busy} onClick={()=>act('approve')}>Approve &amp; post</button></div></>:<div className="gd-note" style={{background:'#d8ecdf'}}>This adjustment is already {sel.status.toLowerCase()}.</div>}
      {msg&&<p className="gd-success">{msg}</p>}
    </div>:<div className="gd-empty">Select an adjustment to inspect the approval trail.</div>}</div></div>
  </>;
}