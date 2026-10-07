import React, { useEffect, useState } from 'react';
import { api, inr } from '../api';
import { Tag } from './ScreenKit';
import DataReset from './DataReset';

export default function Settings(){
  const [data,setData]=useState(null),[tab,setTab]=useState('Organization'),[draft,setDraft]=useState(null),[msg,setMsg]=useState(''),[loadErr,setLoadErr]=useState('');
  const load=()=>api('/settings').then(d=>{
    if(!d.org)throw new Error('No organization record found. Run backend/sql/reference-data.sql or npm run seed:data.');
    setLoadErr('');
    setData(d);
    setDraft({
      name:d.org.name,gstin:d.org.gstin,stateCode:d.org.state_code,address:d.org.address,
      requireCreditOverride:!!d.org.require_credit_override,
      requireBatchReason:!!d.org.require_batch_reason,
      ewayThreshold:d.org.eway_threshold,
      warehouses:d.warehouses.map(w=>({...w,allow_negative:!!w.allow_negative}))
    });
  }).catch(e=>setLoadErr(e.message||'Settings could not be loaded'));
  useEffect(()=>{load()},[]);
  const save=async()=>{try{await api('/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});setMsg('Changes saved and audited');await load()}catch(e){setMsg(e.message)}};
  if(!draft)return loadErr?<div className="gd-soon" role="alert">Could not load settings: {loadErr} <button className="gd-btn" onClick={load}>Retry</button></div>:<div className="gd-soon">Loading settings…</div>;
  const tabs=['Organization','Tax & GST','Numbering','Users & access','Print profiles','Notifications','Integrations','Data & backup'];
  const updateWarehouse=(needle,key,value)=>setDraft({...draft,warehouses:draft.warehouses.map(w=>w.name.includes(needle)?{...w,[key]:value}:w)});
  return <>
    <div className="gd-h"><div><h1>Settings</h1><p>Organization, GST, numbering, access and document-rendering controls</p></div><div className="gd-actions"><button className="gd-btn">Audit log</button><button className="gd-btn pri" onClick={save}>Save changes</button></div></div>
    <div className="gd-settings">
      <aside className="gd-settings-nav">{tabs.map(t=><button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{t}</button>)}</aside>
      <section className="gd-card gd-settings-main">
        {tab==='Data & backup'&&<DataReset/>}
        <div className="gd-settings-section"><div><h3>General</h3><p>Changes are audited with user, timestamp and old/new value.</p></div>
          <div className="gd-settings-grid">
            <label><small>ORGANIZATION NAME</small><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
            <label><small>FISCAL YEAR</small><input value="FY 2026-27" readOnly/></label>
            <label><small>GSTIN</small><input value={draft.gstin||''} onChange={e=>setDraft({...draft,gstin:e.target.value})}/></label>
            <label><small>STATE</small><input value={(draft.stateCode||'36')+' Telangana'} onChange={e=>setDraft({...draft,stateCode:e.target.value.split(' ')[0]})}/></label>
            <label><small>DEFAULT GODOWN</small><input value={data.warehouses[0]?.name||'Balanagar Godown'} readOnly/></label>
            <label><small>OWNER</small><input value="Harish K." readOnly/></label>
          </div>
        </div>
        <div className="gd-settings-section"><div><h3>Posting controls</h3></div>
          <div className="gd-setting-list">
            <Toggle label="Negative stock at Balanagar" value={!!draft.warehouses.find(w=>w.name.includes('Balanagar'))?.allow_negative} onChange={v=>updateWarehouse('Balanagar','allow_negative',v)}/>
            <Toggle label="Negative stock at Shop Counter" value={!!draft.warehouses.find(w=>w.name.includes('Shop'))?.allow_negative} onChange={v=>updateWarehouse('Shop','allow_negative',v)}/>
            <Toggle label="Require owner override on credit breach" value={!!draft.requireCreditOverride} onChange={v=>setDraft({...draft,requireCreditOverride:v})}/>
            <Toggle label="Require batch reason when FIFO is overridden" value={!!draft.requireBatchReason} onChange={v=>setDraft({...draft,requireBatchReason:v})}/>
          </div>
          <label className="gd-number-setting"><span>E-way bill threshold</span><input type="number" value={draft.ewayThreshold||50000} onChange={e=>setDraft({...draft,ewayThreshold:e.target.value})}/></label>
        </div>
        <div className="gd-settings-section"><div><h3>Document numbering</h3><p>Locked counters remain gapless within FY 2026-27.</p></div>
          <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>DOCUMENT</th><th>FY 2026-27</th><th>NEXT NUMBER</th><th>STATUS</th></tr></thead><tbody>{(data.counters||[]).map(c=><tr key={c.doc_type}><td>{c.doc_type==='SO'?'Sales order':c.doc_type==='DC'?'Delivery challan':'Tax invoice'}</td><td className="gd-mono">{c.doc_type==='SO'?'SO/25-26/':c.doc_type==='DC'?'DC/25-26/':'INV/25-26/'}</td><td className="gd-mono">{String(Number(c.last_no)+1).padStart(5,'0')}</td><td><Tag tone="teal">Locked counter</Tag></td></tr>)}</tbody></table></div>
        </div>
        {msg&&<p className="gd-success">{msg}</p>}
      </section>
    </div>
  </>;
}
function Toggle({label,value,onChange}){return <label className="gd-toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/><i/></label>}
