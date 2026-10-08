import React, { useEffect, useMemo, useState } from 'react';
import { api, inr, lakh, qty } from '../api';
import { AdjustmentModal, TransferModal } from './StockForms';
import { KpiStrip, FilterBar, Tag, dateTime } from './ScreenKit';

const TYPES = { PURCHASE:['Purchase','grn'], DC_ISSUE:['DC issue','org'], TRANSFER_OUT:['Transfer out','teal'], TRANSFER_IN:['Transfer in','teal'], ADJ_UP:['Adjust up','grn'], ADJ_DOWN:['Adjust down','red'] };

export default function GodownDashboard({ route }) {
  const id = (route.match(/\/warehouses\/(\d+)\/dashboard/) || [])[1];
  const [data,setData]=useState(null),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[form,setForm]=useState(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>id&&api(`/warehouses/${id}/dashboard`).then(setData).catch(e=>setData({error:e.message}));
  useEffect(()=>{load()},[id]);
  const rows=useMemo(()=>{
    const term=search.trim().toLowerCase();
    return (data && data.stock||[]).filter(r=>(!term||`${r.name} ${r.sku}`.toLowerCase().includes(term))&&(!status||r.stock_status===status));
  },[data,search,status]);
  if (!data) return <div className="gd-empty">Loading godown dashboard…</div>;
  if (data.error) return <div className="gd-note" role="alert">{data.error}</div>;
  const w=data.warehouse,k=data.kpis||{};
  const toggle=async active=>{setBusy(true);setMsg('');try{await api(`/warehouses/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});setMsg(active?'Godown reactivated':'Godown moved to inactive');await load()}catch(e){setMsg(e.message)}finally{setBusy(false)}};
  return <>
    {form==='adjustment'&&<AdjustmentModal onClose={()=>setForm(null)} onDone={m=>{setForm(null);setMsg(m);load()}}/>}
    {form==='transfer'&&<TransferModal onClose={()=>setForm(null)} onDone={m=>{setForm(null);setMsg(m);load()}}/>}
    <div className="gd-h"><div><div className="gd-cap">GODOWN DASHBOARD</div><h1>{w.name}</h1><p>{w.notes||'Location-level stock, movements and operational controls'} · {w.active?'Operational':'Inactive'}</p></div><div className="gd-actions">{w.active&&<><button className="gd-btn" onClick={()=>setForm('adjustment')}>Adjust stock</button><button className="gd-btn" onClick={()=>setForm('transfer')}>Transfer stock</button></>}{w.active?<button className="gd-btn" disabled={busy} onClick={()=>toggle(false)}>Add to inactive</button>:<button className="gd-btn pri" disabled={busy} onClick={()=>toggle(true)}>Reactivate godown</button>}</div></div>
    {!w.active&&<div className="gd-note" style={{background:'#f8dcd7',color:'var(--red)'}}><b>Inactive godown.</b> New transfers, receipts and stock adjustments are blocked. Historical stock and movements remain visible.</div>}
    {msg&&<div className="gd-note" role="status">{msg}</div>}
    <KpiStrip items={[{label:'STOCK VALUE',value:'₹'+lakh(k.stock_value||0),sub:'On-hand valuation'},{label:'ON HAND',value:qty(k.on_hand||0),sub:'Total physical quantity'},{label:'RESERVED',value:qty(k.reserved||0),sub:'Held for sales orders',color:'var(--org)'},{label:'LIVE SKUs',value:k.live_skus||0,sub:`${k.zero_skus||0} zero-stock`,color:(k.zero_skus||0)?'var(--red)':undefined}]}/>
    <div className="gd-two">
      <div className="gd-card gd-table-card"><div className="gd-ch"><h3>Stock by item</h3><span className="gd-pill">{rows.length} shown · zero stock is explicit</span></div>
        <FilterBar><div className="gd-filter-row"><label className="gd-grow"><span>Search item / SKU</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Item name or SKU"/></label><label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All stock</option><option value="OK">In stock</option><option value="LOW">Below reorder</option><option value="ZERO">Zero stock</option></select></label></div></FilterBar>
        <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>ITEM</th><th>STATUS</th><th className="gd-r">ON HAND</th><th className="gd-r">RESERVED</th><th className="gd-r">FREE</th><th className="gd-r">VALUE</th></tr></thead><tbody>{rows.map(r=><tr key={r.item_id}><td><b>{r.name}</b><small className="gd-mono">{r.sku}</small></td><td><Tag tone={r.stock_status==='ZERO'?'red':r.stock_status==='LOW'?'amb':'grn'}>{r.stock_status==='ZERO'?'Zero stock':r.stock_status==='LOW'?'Below reorder':'In stock'}</Tag></td><td className="gd-r gd-mono">{qty(r.on_hand)} {r.base_uom}</td><td className="gd-r gd-mono">{qty(r.reserved)} {r.base_uom}</td><td className="gd-r gd-mono">{qty(Math.max(0,Number(r.on_hand)-Number(r.reserved)))} {r.base_uom}</td><td className="gd-r gd-mono">₹{inr(r.stock_value,0)}</td></tr>)}{!rows.length&&<tr><td colSpan="6"><div className="gd-empty">No items match this filter.</div></td></tr>}</tbody></table></div>
      </div>
      <div className="gd-card gd-side-panel"><div className="gd-ch"><h3>Location health</h3><Tag tone={w.active?'grn':'red'}>{w.active?'Operational':'Inactive'}</Tag></div><div className="gd-detail-pad"><div className="gd-detail-grid"><div><small>TRACKED SKUs</small><b>{k.tracked_skus||0}</b></div><div><small>ZERO STOCK</small><b style={{color:'var(--red)'}}>{k.zero_skus||0}</b></div><div><small>TODAY'S MOVEMENT</small><b>₹{inr(k.movement_value||0,0)}</b></div><div><small>DOCUMENTS TODAY</small><b>{k.movement_docs||0}</b></div></div><h4>Open stock alerts</h4>{(data.alerts||[]).map(a=><div className="gd-detail-line" key={a.id}><b>{a.item}</b><span><Tag tone={a.kind==='OUT_OF_STOCK'?'red':'amb'}>{a.kind==='OUT_OF_STOCK'?'Zero stock':'Below reorder'}</Tag></span><small>{a.sku} · free {qty(a.free)} / reorder {qty(a.reorder_point)}</small></div>)}{!(data.alerts && data.alerts.length)&&<div className="gd-note" style={{background:'#d8ecdf'}}>No open stock alerts for this godown.</div>}</div></div>
    </div>
    <div className="gd-card gd-table-card"><div className="gd-ch"><h3>Recent movements</h3><a href={`#/ledger?godown=${id}`} style={{color:'var(--teal)',fontWeight:600}}>Open full ledger</a></div><div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>TIME</th><th>DOCUMENT</th><th>ITEM</th><th>TYPE</th><th className="gd-r">QTY</th><th className="gd-r">VALUE</th></tr></thead><tbody>{(data.movements||[]).map(m=>{const t=TYPES[m.type]||[m.type,'teal'];return <tr key={`${m.doc}-${m.time}`}><td className="gd-mono">{dateTime(m.posted_at)}</td><td className="gd-mono"><b>{m.doc}</b></td><td><b>{m.item}</b><small>{m.sku}</small></td><td><Tag tone={t[1]}>{t[0]}</Tag></td><td className="gd-r gd-mono">{m.qty>0?'+':'−'}{qty(Math.abs(m.qty))} {m.uom}</td><td className="gd-r gd-mono">₹{inr(m.value,0)}</td></tr>)}{!(data.movements && data.movements.length)&&<tr><td colSpan="6"><div className="gd-empty">No movements recorded for this godown yet.</div></td></tr>}</tbody></table></div></div>
  </>;
}