import React, { useEffect, useState } from 'react';
import { api, inr, lakh } from '../api';
import { KpiStrip, FilterBar, Tag, Money } from './ScreenKit';

export default function Parties(){
  const [data,setData]=useState(null),[search,setSearch]=useState(''),[type,setType]=useState(''),[status,setStatus]=useState('');
  const load=()=>api('/parties/list?search='+encodeURIComponent(search)+'&type='+type+'&status='+status).then(setData).catch(()=>setData({rows:[],summary:{}}));
  useEffect(()=>{const t=setTimeout(load,120);return()=>clearTimeout(t)},[search,type,status]);
  const s=data?.summary||{};
  return <>
    <div className="gd-h"><div><h1>Parties</h1><p>Customer and supplier master with GST, credit controls and outstanding balances</p></div><div className="gd-actions"><a className="gd-btn" href="#/import?type=PARTIES">Import parties</a><button className="gd-btn pri">New party</button></div></div>
    <KpiStrip items={[
      {label:'ACTIVE CUSTOMERS',value:s.customers?.n||0,sub:(s.customers?.gst||0)+' GST registered'},
      {label:'SUPPLIERS',value:s.suppliers?.n||0,sub:(s.suppliers?.preferred||0)+' preferred suppliers'},
      {label:'RECEIVABLES',value:'₹'+lakh(s.receivables?.value||0),sub:(s.receivables?.n||0)+' open invoices',color:'var(--org)'},
      {label:'ON HOLD',value:s.onHold?.n||0,sub:'credit or compliance block',color:'var(--red)'},
    ]}/>
    <FilterBar><div className="gd-filter-row"><label className="gd-grow"><span>Search party, GSTIN or mobile</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rajesh Constructions" /></label><label><span>Type</span><select value={type} onChange={e=>setType(e.target.value)}><option value="">All</option><option value="CUSTOMER">Customers</option><option value="SUPPLIER">Suppliers</option></select></label><button className="gd-btn">More filters</button></div>
      <div className="gd-chips gd-filter-chips">{[
        ['', 'All', (s.customers?.n||0)+(s.suppliers?.n||0)],
        ['CUSTOMER','Customers',s.customers?.n||0],
        ['SUPPLIER','Suppliers',s.suppliers?.n||0],
        ['ON_HOLD','On hold',s.onHold?.n||0],
      ].map(([k,l,n])=><button key={k} className={'gd-chip'+((k==='ON_HOLD'?status:type)===k?' on':'')} onClick={()=>{if(k==='ON_HOLD'){setStatus('ON_HOLD')}else{setStatus('');setType(k)}}}>{l} <em>{n}</em></button>)}</div>
    </FilterBar>
    <div className="gd-card gd-table-card"><div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>PARTY</th><th>TYPE</th><th>GSTIN</th><th>PHONE</th><th className="gd-r">CREDIT LIMIT</th><th className="gd-r">OUTSTANDING</th><th>STATUS</th></tr></thead>
      <tbody>{(data?.rows||[]).map(r=><tr key={r.id}><td><b>{r.name}</b><small>{r.id?('Party #'+r.id):''}</small></td><td>{r.party_type==='CUSTOMER'?'Customer':'Supplier'}</td><td className="gd-mono">{r.gstin||'Unregistered'}</td><td className="gd-mono">{r.mobile||'—'}</td><td className="gd-r"><Money value={r.credit_limit}/></td><td className="gd-r"><Money value={r.outstanding}/></td><td><Tag tone={r.status==='ON_HOLD'?'red':r.status==='CREDIT_WATCH'?'amb':'grn'}>{r.status==='CREDIT_WATCH'?'Credit watch':r.status==='ON_HOLD'?'On hold':'Active'}</Tag></td></tr>)}</tbody>
    </table></div></div>
  </>;
}