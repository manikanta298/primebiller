import React, { useEffect, useState } from 'react';
import { api } from './api';
import Dashboard from './pages/Dashboard.jsx';
import Alerts from './pages/Alerts.jsx';
import SalesOrder from './pages/SalesOrder.jsx';
import DeliveryChallan from './pages/DeliveryChallan.jsx';
import InvoiceConvert from './pages/InvoiceConvert.jsx';
import ChallanTransit from './pages/ChallanTransit.jsx';
import ItemDetail from './pages/ItemDetail.jsx';
import BulkImport from './pages/BulkImport.jsx';
import PrintPreview from './pages/PrintPreview.jsx';
import FindDocument from './pages/FindDocument.jsx';

const NAV = [
  ['OVERVIEW', [['Dashboard', '/dashboard'], ['Find a document', '/find']]],
  ['SALES', [['Sales orders', '/sales-orders'], ['Delivery challans', '/challans'], ['Tax invoices', '/invoices'], ['Receipts & advances', '/receipts']]],
  ['INVENTORY', [['Stock ledger', '/ledger'], ['Alerts', '/alerts'], ['Transfers', '/transfers'], ['Adjustments', '/adjustments']]],
  ['MASTERS', [['Items', '/items'], ['Parties', '/parties'], ['Warehouses', '/warehouses']]],
  ['OPERATIONS', [['Bulk import', '/import'], ['Reports & GSTR-1', '/reports'], ['Print profiles', '/print'], ['Settings', '/settings']]],
];
const PAGES = { '/dashboard': Dashboard, '/find': FindDocument, '/alerts': Alerts, '/sales-orders': SalesOrder, '/challans': DeliveryChallan, '/invoices': InvoiceConvert, '/items': ItemDetail, '/import': BulkImport, '/print': PrintPreview };

const Chevron = () => <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m5 8 5 5 5-5" /></svg>;

export default function Shell({ route, user, onSignOut }) {
  const [org, setOrg] = useState(null);
  const [godowns, setGodowns] = useState([]);
  const [godown, setGodown] = useState('all');
  useEffect(() => { api('/org').then(setOrg); api('/warehouses').then(setGodowns); }, []);
  const path = '/' + (route.split('?')[0].split('/')[1] || 'dashboard');
  const Page = path === '/challans' && route.includes('/transit') ? ChallanTransit : PAGES[path];

  return (
    <div className="gd-app">
      <aside className="gd-side">
        <div className="gd-brand"><span className="gd-logo">▣</span><b>Girder</b><i>mock</i></div>
        {NAV.map(([group, links]) => (
          <div key={group}>
            <div className="gd-group">{group}</div>
            {links.map(([label, to]) => (
              <a key={to} href={`#${to}`} className={`gd-link${path === to ? ' on' : ''}`}>{label}</a>
            ))}
          </div>
        ))}
        <div className="gd-user" onClick={onSignOut} title="Sign out">
          <b>{user.name || 'Harish K.'}</b><span>Owner · all godowns</span>
        </div>
      </aside>
      <div className="gd-main">
        <header className="gd-top">
          <label className="gd-sel"><small>ORG</small><b>{org?.name}</b><Chevron /></label>
          <label className="gd-sel"><small>GODOWN</small>
            <select value={godown} onChange={(e) => setGodown(e.target.value)}>
              <option value="all">All godowns</option>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name.split(' ')[0]}</option>)}
            </select><Chevron /></label>
          <div className="gd-search"><span>⌕</span><input placeholder="Customer, mobile, GSTIN, doc no." /><kbd>/</kbd></div>
          <span className="gd-spacer" />
          <button className="gd-icon" aria-label="Notifications">🔔</button>
          <button className="gd-icon" aria-label="Help">?</button>
        </header>
        <main className="gd-content">
          {Page ? <Page godown={godown} /> : <div className="gd-soon"><h1>{path.slice(1)}</h1><p>This screen is in the next build phase.</p></div>}
        </main>
      </div>
    </div>
  );
}
