import React, { useState } from 'react';
import { api, base } from '../api';

const TYPES = {
  ITEMS: { required:['sku','name','hsn','gst_rate','base_uom'], label:'Items', columns:['sku','name','hsn','gst_rate','base_uom','batch_tracked','valuation','brand','category'] },
  WAREHOUSES: { required:['name'], label:'Warehouses', columns:['name','notes','allow_negative','default_uom','default_reorder','max_stock'] },
  PARTIES: { required:['name'], label:'Parties', columns:['name','party_type','gstin','mobile','credit_limit','terms','status','preferred'] },
};
const H = {'Content-Type':'application/json'};
const csvEscape=(v)=>`"${String(v).replace(/"/g,'""')}"`;
const sample={
  ITEMS:['SKU-001','Sample item','271019','18','NOS','true','FIFO','Brand','Category'],
  WAREHOUSES:['Main Warehouse','Primary stock location','false','NOS','10','1000'],
  PARTIES:['Sample Customer','CUSTOMER','36ABCDE1234F1Z5','9876543210','50000','Net 30','ACTIVE','false'],
};

export default function BulkImport({ route }) {
  const query=new URLSearchParams(String(route||'').split('?')[1]||'');
  const initial=TYPES[query.get('type')?.toUpperCase()] ? query.get('type').toUpperCase() : 'ITEMS';
  const [type,setType]=useState(initial),[job,setJob]=useState(null),[rows,setRows]=useState([]),[msg,setMsg]=useState('');
  const meta=TYPES[type];
  const refresh=async(id)=>{const s=await api(`/imports/${id}`);setJob(s);setRows(await api(`/imports/${id}/rows?errorsOnly=1`));};
  const upload=async(file)=>{
    try{
      setMsg(`Uploading ${file.name}…`);
      const r=await fetch(`${base}/api/imports?type=${type}&filename=${encodeURIComponent(file.name)}`,{method:'POST',credentials:'include',headers:{'Content-Type':'text/csv'},body:await file.text()});
      const body=await r.json();if(!r.ok)throw new Error(body.error||`Upload failed (${r.status})`);
      setJob(body);setRows(await api(`/imports/${body.job.id}/rows?errorsOnly=1`));setMsg('');
    }catch(e){setMsg(e.message||'Upload failed');}
  };
  const edit=async(row,field,value)=>{try{const s=await api(`/imports/${job.job.id}/rows/${row}`,{method:'PATCH',headers:H,body:JSON.stringify({field,value})});setJob(s);setRows(await api(`/imports/${job.job.id}/rows?errorsOnly=1`));}catch(e){setMsg(e.message);}};
  const commit=async()=>{try{const r=await api(`/imports/${job.job.id}/commit`,{method:'POST'});setMsg(`Committed ${r.posted} ${meta.label.toLowerCase()}`);await refresh(job.job.id);}catch(e){setMsg(e.message);}};
  const templateUrl=`${base}/api/imports/templates/${type.toLowerCase()}.csv`;
  const downloadSample=()=>{const blob=new Blob([meta.columns.join(',')+'\n'+sample[type].map(csvEscape).join(',')+'\n'],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${type.toLowerCase()}-sample.csv`;a.click();URL.revokeObjectURL(a.href);};
  return <>
    <div className="gd-h"><div><h1>Bulk import</h1><p>Import one master type at a time with validation before commit.</p></div><div className="gd-actions"><a className="gd-btn" href={templateUrl}>Download CSV template</a><label className="gd-btn pri">Upload {meta.label}<input type="file" accept=".csv,text/csv" hidden onChange={e=>{const f=e.target.files[0];e.target.value='';if(f)upload(f)}} /></label></div></div>
    <div className="gd-card gd-filterbar"><div className="gd-filter-row"><label className="gd-grow"><span>Import type</span><select value={type} onChange={e=>{setType(e.target.value);setJob(null);setRows([]);setMsg('')}}><option value="ITEMS">Items</option><option value="WAREHOUSES">Warehouses</option><option value="PARTIES">Parties</option></select></label><button className="gd-btn" onClick={downloadSample}>Download sample CSV</button><span className="gd-footnote">Required: {meta.required.join(', ')} · Optional: {meta.columns.filter(c=>!meta.required.includes(c)).join(', ')||'none'}</span></div></div>
    {msg&&<div className="gd-note" role="status">{msg}</div>}
    {job&&<div className="gd-card gd-table-card"><div className="gd-table-title"><b>{meta.label} import</b><span>{job.job.rows_total} rows · {job.counts.errors} errors · {job.job.status}</span></div>
      <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>ROW</th>{meta.columns.map(c=><th key={c}>{c.toUpperCase()}</th>)}<th>VALIDATION</th></tr></thead>
      <tbody>{rows.map(r=>{const p=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;return <tr key={r.row_no}><td className="gd-mono">{r.row_no}</td>{meta.columns.map(c=><td key={c}>{r.error_kind&&r.error_field&&r.error_field!==c?p[c]||'—':<input className={r.error_kind?'gd-err':'gd-cell'} defaultValue={p[c]||''} onBlur={e=>{if(e.target.value!==String(p[c]??''))edit(r.row_no,c,e.target.value)}} />}</td>)}<td>{r.error_msg||'—'}</td></tr>})}</tbody></table></div>
      <div className="gd-pager"><span>{rows.length} error rows shown</span><button className="gd-btn pri" disabled={job.counts.errors>0} onClick={commit}>Commit {job.counts.valid} valid rows</button></div>
    </div>}
    {!job&&<div className="gd-card gd-empty">Choose an import type, download its template, fill the CSV, and upload it. Invalid rows are kept out of the commit until corrected.</div>}
  </>;
}
