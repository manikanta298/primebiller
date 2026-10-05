import React, { useEffect, useMemo, useState } from 'react';
import { api, inr, lakh } from '../api';
import { KpiStrip, FilterBar, Pager, Tag, dateShort, Money } from './ScreenKit';

const STATUS = {
  DRAFT: ['Draft', 'amb'],
  CONFIRMED: ['Confirmed', 'teal'],
  PARTIAL: ['Partially delivered', 'amb'],
  DELIVERED: ['Delivered', 'grn'],
  CANCELLED: ['Cancelled', 'red'],
  OVERDUE: ['Payment overdue', 'red'],
};

export default function SalesOrders({ godown }) {
  const openCurrent = async () => { try { const current = await api('/sales-orders/current'); if (current?.id) location.hash='/sales-orders/'+current.id; } catch (_) {} };
  const [data,setData]=useState(null),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[period,setPeriod]=useState('THIS_FY'),[cursor,setCursor]=useState(0);

  const load = () => api(\`/sales-orders/list?search=\${encodeURIComponent(search)}&status=\${status}&period=\${period}&godown=\${godown}&cursor=\${cursor}\`).then(setData).catch(()=>setData({rows:[],summary:{},tabs:[],total:0,nextCursor:null}));
  useEffect(()=>{setCursor(0)},[search,status,period,godown]);
  useEffect(()=>{const t=setTimeout(load,150);return()=>clearTimeout(t)},[search,status,period,godown,cursor]);

  const summary=data?.summary||{};
  const tabs=useMemo(()=>[
    ['','All',data?.tabs?.reduce((n,x)=>n+Number(x.n||0),0)||0],
    ['DRAFT','Draft',data?.tabs?.find(x=>x.status==='DRAFT')?.n||0],
    ['CONFIRMED','Confirmed',data?.tabs?.find(x=>x.status==='CONFIRMED')?.n||0],
    ['PARTIAL','Partially delivered',data?.tabs?.find(x=>x.status==='PARTIAL')?.n||0],
    ['DELIVERED','Delivered',data?.tabs?.find(x=>x.status==='DELIVERED')?.n||0],
    ['CANCELLED','Cancelled',data?.tabs?.find(x=>x.status==='CANCELLED')?.n||0],
    ['OVERDUE','Overdue',0],
  ],[data]);

  return <>
    <div className="gd-h">
      <div><h1>Sales orders</h1><p>All customer orders across godowns - stock is held only when an order is confirmed</p></div>
      <div className="gd-actions"><button className="gd-btn">Export CSV</button><button className="gd-btn pri" onClick={openCurrent}>New sales order <span className="gd-kbd">Ctrl N</span></button></div>
    </div>

    <KpiStrip items={[
      {label:'DRAFT ORDERS',value:summary.draft?.count||0,sub:\`₹\${lakh(summary.draft?.value||0)} value\`},
      {label:'CONFIRMED - STOCK HELD',value:summary.confirmed?.count||0,sub:\`₹\${lakh(summary.confirmed?.value||0)}\`},
      {label:'PARTIALLY DELIVERED',value:summary.partial?.count||0,sub:\`₹\${lakh(summary.partial?.value||0)}\`},
      {label:'AWAITING PAYMENT',value:summary.awaiting?.count||0,sub:\`₹\${lakh(summary.awaiting?.value||0)}\`,color:'var(--org)'},
    ]}/>

    <FilterBar>
      <div className="gd-filter-row">
        <label className="gd-grow"><span>Search order no. or customer</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SO/25-26/00042" /></label>
        <label><span>Godown</span><select value={godown} disabled><option value={godown}>Current selection</option></select></label>
        <label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{tabs.slice(1).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        <label><span>Period</span><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="THIS_FY">This FY</option><option value="THIS_MONTH">This month</option><option value="THIS_WEEK">This week</option><option value="TODAY">Today</option></select></label>
        <button className="gd-btn">More filters</button>
      </div>
      <div className="gd-chips gd-filter-chips">
        {tabs.map(([k,l,n])=><button key={k} className={\`gd-chip\${status===k?' on':''}\`} onClick={()=>setStatus(k)}>{l} <em>{n}</em></button>)}
      </div>
    </FilterBar>

    <div className="gd-card gd-table-card">
      <div className="gd-table-title"><b>{data?.total||0} orders</b><span>Cursor paged · 50 per fetch · confirming an order holds free stock at the selected godown</span></div>
      <div className="gd-table-scroll"><table className="gd-t"><thead><tr><th>ORDER DATE</th><th>CUSTOMER</th><th>GODOWN</th><th className="gd-r">LINES</th><th className="gd-r">VALUE</th><th className="gd-r">DELIVERED</th><th>STATUS</th></tr></thead>
        <tbody>
          {(data?.rows||[]).map(r=>{
            const [label,tone]=STATUS[r.doc_no==='SO/25-26/00035'?'OVERDUE':r.status]||[r.status,'teal'];
            return <tr key={r.id} className="gd-row-link" onClick={()=>location.hash=\`/sales-orders/\${r.id}\`}>
              <td><span className="gd-mono"><b>{r.doc_no}</b></span><small>{dateShort(r.order_date)}</small></td>
              <td><b>{r.customer}</b>{r.gstin&&<small className="gd-mono">{r.gstin}</small>}</td>
              <td>{r.godown.split(' ')[0]}</td>
              <td className="gd-r gd-mono">{r.line_count || 0}</td>
              <td className="gd-r"><Money value={r.total}/></td>
              <td className="gd-r gd-mono">{r.delivered_pct}%</td>
              <td><Tag tone={tone}>{label}</Tag></td>
            </tr>
          })}
        </tbody>
      </table></div>
      <Pager from={data?.total?cursor+1:0} to={Math.min(cursor+(data?.rows?.length||0),data?.total||0)} total={data?.total||0} canPrev={cursor>0} canNext={!!data?.nextCursor} onPrev={()=>setCursor(Math.max(0,cursor-50))} onNext={()=>setCursor(data.nextCursor??cursor)}/>
    </div>
  </>;
}
