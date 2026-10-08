import React, { useEffect, useState } from 'react';
import { api, inr } from '../api';
import { TransferModal } from './StockForms';
import { KpiStrip, FilterBar, Tag, dateShort, Money } from './ScreenKit';

const tones={DRAFT:'amb',IN_TRANSIT:'org',COMPLETED:'grn',CANCELLED:'red'};
export default function Transfers(){
  const [data,setData]=useState(null),[status,setStatus]=useState(''),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[form,setForm]=useState(false);
  const load=()=>api('/transfers?status='+status+'&id='+(selected?.id||'')).then(d=>{setData(d);if(selected) setSelected(d.selected)}).catch(()=>setData({rows:[],summary:{},selected:null}));
  useEffect(()=>{load()},[status]);
  const pick=async id=>{const d=await api('/transfers?id='+id);setData(d);setSelected(d.selected)};
  const receive=async()=>{if(!selected)return;setBusy(true);try{await api('/transfers/'+selected.id+'/receive',{method:'POST'});setMsg('Destination receipt posted');await pick(selected.id)}catch(e){setMsg(e.message)}finally{setBusy(false)}};
  const s=data?.summary||{};
  return <>
    {form&&<TransferModal onClose={()=>setForm(false)} onDone={m=>{setForm(false);setMsg(m);load()}}/>}
    <div className="gd-h"><div><h1>Stock transfers</h1><p>Move stock between godowns with an auditable issue and receipt trail</p></div><div className="gd-actions"><button className="gd-btn">Export CSV</button><button className="gd-btn pri" onClick={()=>setForm(true)}>New transfer</button></div></div>
    <KpiStrip items={[
      {label:'DRAFT',value:s.draft?.n||0,sub:'awaiting post'},
      {label:'IN TRANSIT',value:s.transit?.n||0,sub:'one with POD pending',color:'var(--org)'},
      {label:'COMPLETED THIS FY',value:s.completed?.n||0,sub:'₹'+inr(s.completed?.value||0,0)+' value moved'},
      {label:'PENDING RECEIPT',value:s.pendingReceipt?.n||0,sub:'lines awaiting receipt',color:'var(--amb)'},
    ]}/>
    <div className="gd-two gd-list-split">
      <div>
        <FilterBar><div className="gd-filter-row"><label className="gd-grow"><span>Transfer no. / item</span><input placeholder="XFR/25-26/00031"/></label><label><span>From</span><select><option>Any godown</option></select></label><label><span>To</span><select><option>Any godown</option></select></label><label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option><option value="DRAFT">Draft</option><option value="IN_TRANSIT">In transit</option><option value="COMPLETED">Completed</option></select></label></div></FilterBar>
        <div className="gd-card gd-table-card"><div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>TRANSFER DATE</th><th>FROM</th><th>TO</th><th className="gd-r">LINES</th><th className="gd-r">VALUE</th><th>STATUS</th></tr></thead><tbody>{(data?.rows||[]).map(r=><tr key={r.id} className="gd-row-link" onClick={()=>pick(r.id)}><td><b className="gd-mono">{r.doc_no}</b><small>{dateShort(r.transfer_date)}</small></td><td>{r.from_godown}</td><td>{r.to_godown}</td><td className="gd-r gd-mono">{r.lines}</td><td className="gd-r"><Money value={r.value}/></td><td><Tag tone={tones[r.status]||'teal'}>{r.status==='IN_TRANSIT'?'In transit':r.status[0]+r.status.slice(1).toLowerCase()}</Tag></td></tr>)}</tbody></table></div></div>
      </div>
      <div className="gd-card gd-side-panel"><div className="gd-ch"><h3>Selected transfer</h3>{selected&&<Tag tone={tones[selected.status]||'teal'}>{selected.status==='IN_TRANSIT'?'In transit':selected.status}</Tag>}</div>
        {selected?<div className="gd-detail-pad"><div className="gd-detail-grid"><div><small>STATUS</small><b>{selected.status==='IN_TRANSIT'?'In transit':selected.status}</b></div><div><small>FROM</small><b>{selected.from_godown}</b></div><div><small>TO</small><b>{selected.to_godown}</b></div><div><small>ISSUED</small><b>{dateShort(selected.transfer_date)}</b></div></div>
          <h4>LINES</h4>{(selected.lines||[]).map(l=><div className="gd-detail-line" key={l.id}><b>{l.item}</b><span className="gd-mono">{l.qty} {l.uom} · ₹{inr(l.qty*l.rate,0)}</span><small>{l.batch_no||'Batch pending'}</small></div>)}
          {selected.status==='IN_TRANSIT'&&<><div className="gd-note" style={{background:'#f7ecd0'}}>Destination receipt is still pending. Post receipt after quantity and batch confirmation.</div><button className="gd-btn pri" disabled={busy} onClick={receive}>{busy?'Posting…':'Post destination receipt'}</button></>}{msg&&<p className="gd-success">{msg}</p>}
        </div>:<div className="gd-empty">Select a transfer to inspect the audit trail.</div>}
      </div>
    </div>
  </>;
}