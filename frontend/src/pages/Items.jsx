import React, { useEffect, useState } from 'react';
import { api, inr } from '../api';

export default function Items() {
  const [data,setData]=useState({rows:[]}), [search,setSearch]=useState('');
  // Below 2 characters the list is unfiltered (matches the API), so 1 character never leaves stale results.
  const term=search.trim().length>=2?search.trim():'';
  useEffect(()=>{
    let stale=false;
    const t=setTimeout(async()=>{ try { const d=await api('/items/list?search='+encodeURIComponent(term)); if(!stale) setData(d); } catch { if(!stale) setData({rows:[]}); } },120);
    return()=>{ stale=true; clearTimeout(t); };
  },[term]);
  return <>
    <div className="gd-h"><div><h1>Items</h1><p>Item master with SKU, GST, units, valuation and stock availability</p></div><div className="gd-actions"><a className="gd-btn" href="#/import?type=ITEMS">Import items</a><button className="gd-btn pri">New item</button></div></div>
    <div className="gd-card gd-filterbar"><div className="gd-filter-row"><label className="gd-grow"><span>Search items</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type at least 2 characters…" aria-label="Search items" /></label><span className="gd-footnote">Search starts after 2 characters</span></div></div>
    <div className="gd-card gd-table-card"><div className="gd-table-title"><b>{data.rows.length} items</b><span>{term ? `Filtered by “${term}”` : 'Showing all items'}</span></div>
      <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>ITEM</th><th>SKU</th><th>HSN</th><th>GST</th><th>UOM</th><th>VALUATION</th><th className="gd-r">ON HAND</th></tr></thead>
      <tbody>{data.rows.map(r=><tr key={r.id}><td><b>{r.name}</b><small>{r.brand||r.category||'—'}</small></td><td className="gd-mono">{r.sku}</td><td className="gd-mono">{r.hsn}</td><td>{r.gst_rate}%</td><td>{r.base_uom}</td><td>{r.valuation}</td><td className="gd-r gd-mono">{inr(r.on_hand,3)}</td></tr>)}</tbody></table></div>
      {!data.rows.length && <div className="gd-empty">No matching items found.</div>}
    </div>
  </>;
}
