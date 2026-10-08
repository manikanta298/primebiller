import React, { useEffect, useState } from 'react';
import { AdjustmentModal, TransferModal, MovementChooser } from './StockForms';
import { api, inr, lakh, qty } from '../api';
import { KpiStrip, FilterBar, Tag, dateTime } from './ScreenKit';

const TYPES = { PURCHASE:['Purchase','grn'], DC_ISSUE:['DC issue','org'], TRANSFER_OUT:['Transfer out','teal'], TRANSFER_IN:['Transfer in','teal'], ADJ_UP:['Adjust up','grn'], ADJ_DOWN:['Adjust down','red'] };

export default function StockLedger({ godown }) {
  const [data,setData]=useState(null),[item,setItem]=useState(''),[type,setType]=useState(''),[period,setPeriod]=useState('TODAY'),[form,setForm]=useState(null),[note,setNote]=useState('');
  const load=()=>api('/ledger?item='+encodeURIComponent(item)+'&type='+type+'&period='+period+'&godown='+godown).then(setData).catch(()=>setData({rows:[],summary:{},counts:[]}));
  useEffect(()=>{const t=setTimeout(load,120);return()=>clearTimeout(t)},[item,type,period,godown]);
  const d=data?.summary||{};
  const done=m=>{setForm(null);setNote(m);load()};
  return <>
    {form==='choose'&&<MovementChooser onClose={()=>setForm(null)} onPick={setForm}/>}
    {form==='adjustment'&&<AdjustmentModal onClose={()=>setForm(null)} onDone={done}/>}
    {form==='transfer'&&<TransferModal onClose={()=>setForm(null)} onDone={done}/>}
    {note&&<div className="gd-note" role="status">{note}</div>}
    <div className="gd-h"><div><h1>Stock ledger</h1><p>Every posted stock movement, linked to document, batch, godown and valuation</p></div><div className="gd-actions"><button className="gd-btn">Export ledger</button><button className="gd-btn pri" onClick={()=>setForm('choose')}>New movement</button></div></div>
    <KpiStrip items={[
      {label:'OPENING BALANCE',value:'₹'+lakh(d.opening?.value||0),sub:'weighted average value'},
      {label:'INWARDS TODAY',value:'+₹'+lakh(d.inwards?.value||0),sub:qty(d.inwards?.qty||0)+' qty purchase',color:'var(--teal)'},
      {label:'OUTWARDS TODAY',value:'-₹'+lakh(d.outwards?.value||0),sub:(d.outwards?.docs||0)+' posted issues / transfers',color:'var(--org)'},
      {label:'DOCUMENTS TODAY',value:d.documents||0,sub:'ledger entries posted'},
    ]}/>
    <FilterBar><div className="gd-filter-row">
      <label className="gd-grow"><span>Item / SKU / batch</span><input value={item} onChange={e=>setItem(e.target.value)} placeholder="UltraTech PPC 50kg" /></label>
      <label><span>Godown</span><select value={godown} disabled><option>{godown==='all'?'All godowns':'Selected godown'}</option></select></label>
      <label><span>Type</span><select value={type} onChange={e=>setType(e.target.value)}><option value="">All movement</option>{Object.entries(TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select></label>
      <label><span>Period</span><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="TODAY">Today</option><option value="THIS_WEEK">This week</option><option value="THIS_MONTH">This month</option><option value="THIS_FY">This FY</option></select></label>
    </div><div className="gd-chips gd-filter-chips">{[['','All'],...Object.entries(TYPES)].map(([k,v])=><button key={k} className={'gd-chip'+(type===k?' on':'')} onClick={()=>setType(k)}>{k?v[0]:'All'} <em>{k?(data?.counts?.find(x=>x.type===k)?.n||0):(data?.rows?.length||0)}</em></button>)}</div></FilterBar>
    <div className="gd-card gd-table-card"><div className="gd-table-title"><b>{data?.rows?.length||0} entries</b><span>Balances are post-entry free + reserved where applicable · FIFO suggestions exclude expired and over-aged batches</span></div>
      <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>TIME</th><th>DOCUMENT</th><th>ITEM / BATCH</th><th>GODOWN</th><th>TYPE</th><th className="gd-r">QTY</th><th className="gd-r">RATE</th><th className="gd-r">VALUE</th><th className="gd-r">BALANCE</th></tr></thead>
      <tbody>{(data?.rows||[]).map(r=>{const tv=TYPES[r.movement]||[r.movement,'teal']; const absQty=Math.abs(Number(r.qty)); const rate=absQty?Number(r.value)/absQty:0; return <tr key={r.id}><td className="gd-mono">{dateTime(r.posted_at)}</td><td className="gd-mono"><b>{r.doc_no}</b></td><td><b>{r.item}</b><small className="gd-mono">{r.sku}{r.batch_no?' · '+r.batch_no:''}</small></td><td>{r.godown.split(' ')[0]}</td><td><Tag tone={tv[1]}>{tv[0]}</Tag></td><td className="gd-r gd-mono">{r.qty>0?'+':'−'}{qty(absQty)} {r.uom}</td><td className="gd-r gd-mono">₹{inr(rate,0)}</td><td className="gd-r gd-mono">{r.qty>0?'+':'−'}₹{inr(r.value,0)}</td><td className="gd-r gd-mono">{qty(r.balance_qty)} {r.uom}</td></tr>})}</tbody></table></div>
      <div className="gd-pager"><span>{data?.rows?.length||0} entries shown</span></div>
    </div>
  </>;
}