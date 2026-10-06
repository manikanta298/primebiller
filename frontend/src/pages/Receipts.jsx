import React, { useEffect, useState } from 'react';
import { api, inr, lakh } from '../api';
import { KpiStrip, FilterBar, Pager, Tag, dateShort, Money } from './ScreenKit';

export default function Receipts() {
  const [data,setData]=useState(null),[search,setSearch]=useState(''),[mode,setMode]=useState(''),[period,setPeriod]=useState('THIS_MONTH'),[cursor,setCursor]=useState(0);
  const load=()=>api('/receipts/list?search='+encodeURIComponent(search)+'&mode='+mode+'&period='+period+'&cursor='+cursor).then(setData).catch(()=>setData({rows:[],summary:{},allocation:[]}));
  useEffect(()=>setCursor(0),[search,mode,period]);
  useEffect(()=>{const t=setTimeout(load,120);return()=>clearTimeout(t)},[search,mode,period,cursor]);
  return <>
    <div className="gd-h"><div><h1>Receipts &amp; advances</h1><p>Record collections, keep unadjusted advances visible, and allocate against invoices oldest first</p></div>
      <div className="gd-actions"><button className="gd-btn">Export CSV</button><button className="gd-btn pri">New receipt</button></div></div>
    <KpiStrip items={[
      {label:'UNADJUSTED ADVANCES',value:'₹'+lakh(data?.summary?.advances?.value||0),sub:(data?.summary?.advances?.n||0)+' receipts on account',color:'var(--org)'},
      {label:'COLLECTED THIS MONTH',value:'₹'+lakh(data?.summary?.collected?.value||0),sub:(data?.summary?.collected?.n||0)+' documents posted'},
      {label:'OVERDUE RECEIVABLE',value:'₹'+lakh(data?.summary?.overdue?.value||0),sub:(data?.summary?.overdue?.n||0)+' invoices',color:'var(--red)'},
      {label:'CHEQUES PENDING',value:data?.summary?.cheques?.n||0,sub:'₹'+inr(data?.summary?.cheques?.value||0,0)+' under clearance',color:'var(--amb)'},
    ]}/>
    <FilterBar><div className="gd-filter-row">
      <label className="gd-grow"><span>Search receipt no. or party</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="RCT/25-26/00084" /></label>
      <label><span>Mode</span><select value={mode} onChange={e=>setMode(e.target.value)}><option value="">All</option><option>NEFT</option><option>Cheque</option><option>Cash</option><option>UPI</option></select></label>
      <label><span>Status</span><select><option>Posted</option><option>Advance</option><option>Clearing</option></select></label>
      <label><span>Period</span><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="THIS_MONTH">This month</option><option value="THIS_WEEK">This week</option><option value="TODAY">Today</option><option value="THIS_FY">This FY</option></select></label>
      <button className="gd-btn">More filters</button>
    </div><div className="gd-tabs"><span className="on">Receipts {(data?.counts?.[0]?.n||0)}</span><span>Advances {(data?.counts?.[1]?.n||0)}</span><span>Allocations</span><span>Bank settlement</span></div></FilterBar>
    <div className="gd-two gd-list-split">
      <div className="gd-card gd-table-card"><div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>RECEIPT DATE</th><th>PARTY</th><th>MODE</th><th className="gd-r">AMOUNT</th><th className="gd-r">ALLOCATED</th><th>STATUS</th></tr></thead>
        <tbody>{(data?.rows||[]).map(r=>{const tone=r.status==='Advance'?'amb':r.status==='Clearing'?'org':'grn';return <tr key={r.id}><td><b className="gd-mono">{r.doc_no}</b><small>{dateShort(r.receipt_date)}</small></td><td>{r.party}</td><td>{r.mode}</td><td className="gd-r"><Money value={r.amount}/></td><td className="gd-r gd-mono">{inr(r.allocated,0)}</td><td><Tag tone={tone}>{r.status}</Tag></td></tr>})}</tbody>
      </table></div><Pager from={data?.rows?.length?cursor+1:0} to={data?.rows?.length?cursor+data.rows.length:0} total={data?.rows?.length||0} canPrev={cursor>0} canNext={false} onPrev={()=>setCursor(Math.max(0,cursor-50))}/></div>
      <div className="gd-card gd-side-panel"><div className="gd-ch"><h3>Allocation queue oldest first</h3></div>
        {(data?.allocation||[]).map((a,i)=><div className="gd-alloc" key={a.receipt_id+'-'+a.invoice_no+'-'+i}>
          <div><b className="gd-mono">{a.doc_no}</b><span>{dateShort(a.receipt_date)} · {a.mode} · unadjusted <b>₹{inr(a.unadjusted,0)}</b></span></div>
          <div className="gd-alloc-arrow">↓</div>
          <div><b className="gd-mono">{a.invoice_no}</b><span>{dateShort(a.invoice_date)} · {a.overdue_days>0?'overdue '+a.overdue_days+' d':'open'} · ₹{inr(a.balance_due,0)}</span></div>
        </div>)}
        <div className="gd-note" style={{background:'#f7ecd0',margin:0,borderRadius:'0 0 12px 12px'}}>Applying an advance writes a receipt allocation and reverses the advance-tax liability declared in the month the money came in.</div>
      </div>
    </div>
  </>;
}