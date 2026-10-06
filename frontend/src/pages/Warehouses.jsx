import React, { useEffect, useState } from 'react';
import { api, inr } from '../api';
import { Tag } from './ScreenKit';

export default function Warehouses(){
  const [data,setData]=useState(null),[editing,setEditing]=useState(null),[draft,setDraft]=useState(null),[msg,setMsg]=useState(''),[search,setSearch]=useState('');
  const term=search.trim().length>=2?search.trim():'';
  const [reload,setReload]=useState(0);
  const load=()=>setReload(n=>n+1);
  useEffect(()=>{
    let stale=false;
    const t=setTimeout(()=>{api('/warehouses/list?search='+encodeURIComponent(term)).then(d=>{if(!stale)setData(d)}).catch(()=>{if(!stale)setData({rows:[]})})},120);
    return()=>{stale=true;clearTimeout(t)};
  },[term,reload]);
  const start=w=>{setEditing(w.id);setDraft({...w,allow_negative:!!w.allow_negative});setMsg('')};
  const save=async()=>{try{await api('/warehouses/'+draft.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:draft.name,notes:draft.notes,allowNegative:draft.allow_negative,defaultUom:draft.default_uom,defaultReorder:draft.default_reorder,maxStock:draft.max_stock})});setMsg('Godown settings saved');await load();setEditing(null)}catch(e){setMsg(e.message)}};
  return <>
    <div className="gd-h"><div><h1>Warehouses / godowns</h1><p>Manage godown controls, reorder points, negative-stock policy and stock value</p></div><div className="gd-actions"><a className="gd-btn" href="#/import?type=WAREHOUSES">Import warehouses</a><button className="gd-btn pri">New godown</button></div></div>
    <div className="gd-card gd-filterbar"><div className="gd-filter-row"><label className="gd-grow"><span>Search warehouses</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type at least 2 characters…" aria-label="Search warehouses" /></label><span className="gd-footnote">Search starts after 2 characters</span></div></div><div className="gd-card-grid">{(data?.rows||[]).map(w=><div className="gd-card gd-godown-card" key={w.id}>
      <div className="gd-godown-head"><div><h3>{w.name}</h3><span>{w.notes}</span></div><Tag tone={w.allow_negative?'amb':'grn'}>{w.active?'Active':'Inactive'}</Tag></div>
      <div className="gd-godown-value">₹{inr(w.stock_value,0)}</div><div className="gd-godown-sub">Stock value · {w.active_skus||w.live_skus||0} SKUs</div>
      <div className="gd-godown-meta"><span>Reorder points <b>{inr(w.default_reorder||0,0)} / SKU</b></span><span>Negative stock <b>{w.allow_negative?'Allowed':'Blocked'}</b></span><span>Alerts <b>{w.alerts||0}</b></span></div>
      <button className="gd-btn" onClick={()=>start(w)}>Edit controls</button>
    </div>)}</div>
    <div className="gd-card gd-table-card"><div className="gd-ch"><h3>Godown controls changes are audited</h3></div><div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>GODOWN</th><th>DEFAULT UOM</th><th className="gd-r">REORDER</th><th className="gd-r">MAX STOCK</th><th>NEGATIVE</th><th>LAST SYNC</th><th></th></tr></thead><tbody>{(data?.rows||[]).map(w=><tr key={w.id}><td><b>{w.name}</b></td><td>{w.default_uom}</td><td className="gd-r gd-mono">{inr(w.default_reorder,3)}</td><td className="gd-r gd-mono">{inr(w.max_stock,3)}</td><td><Tag tone={w.allow_negative?'amb':'grn'}>{w.allow_negative?'Allowed':'Blocked'}</Tag></td><td>22 Sep 2026, 11:20</td><td><button className="gd-btn" onClick={()=>start(w)}>Edit</button></td></tr>)}</tbody></table></div></div>
    {editing&&draft&&<div className="gd-modal-wrap"><div className="gd-modal"><div className="gd-ch"><h3>Edit godown controls</h3><button className="gd-icon" onClick={()=>setEditing(null)}>×</button></div>
      <div className="gd-modal-form"><label><small>NAME</small><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label><small>DEFAULT UOM</small><input value={draft.default_uom||''} onChange={e=>setDraft({...draft,default_uom:e.target.value})}/></label><label><small>REORDER</small><input type="number" value={draft.default_reorder||0} onChange={e=>setDraft({...draft,default_reorder:e.target.value})}/></label><label><small>MAX STOCK</small><input type="number" value={draft.max_stock||''} onChange={e=>setDraft({...draft,max_stock:e.target.value})}/></label><label className="gd-check"><input type="checkbox" checked={draft.allow_negative} onChange={e=>setDraft({...draft,allow_negative:e.target.checked})}/> Allow negative stock</label></div>
      <div className="gd-modal-actions"><button className="gd-btn" onClick={()=>setEditing(null)}>Cancel</button><button className="gd-btn pri" onClick={save}>Save changes</button></div>{msg&&<p className="gd-success">{msg}</p>}
    </div></div>}
  </>;
}