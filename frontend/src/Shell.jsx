import React, { useEffect, useState } from 'react';
import { api } from './api';
import Dashboard from './pages/Dashboard.jsx';
import Alerts from './pages/Alerts.jsx';
import SalesOrder from './pages/SalesOrder.jsx';
import SalesOrders from './pages/SalesOrders.jsx';
import DeliveryChallan from './pages/DeliveryChallan.jsx';
import InvoiceConvert from './pages/InvoiceConvert.jsx';
import ChallanTransit from './pages/ChallanTransit.jsx';
import ItemDetail from './pages/ItemDetail.jsx';
import BulkImport from './pages/BulkImport.jsx';
import PrintPreview from './pages/PrintPreview.jsx';
import FindDocument from './pages/FindDocument.jsx';
import Receipts from './pages/Receipts.jsx';
import StockLedger from './pages/StockLedger.jsx';
import Transfers from './pages/Transfers.jsx';
import Adjustments from './pages/Adjustments.jsx';
import Parties from './pages/Parties.jsx';
import Warehouses from './pages/Warehouses.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['OVERVIEW', [['Dashboard', '/dashboard'], ['Find a document', '/find']]],
  ['SALES', [['Sales orders', '/sales-orders'], ['Delivery challans', '/challans'], ['Tax invoices', '/invoices'], ['Receipts & advances', '/receipts']]],
  ['INVENTORY', [['Stock ledger', '/ledger'], ['Alerts', '/alerts'], ['Transfers', '/transfers'], ['Adjustments', '/adjustments']]],
  ['MASTERS', [['Items', '/items'], ['Parties', '/parties'], ['Warehouses', '/warehouses']]],
  ['OPERATIONS', [['Bulk import', '/import'], ['Reports & GSTR-1', '/reports'], ['Print profiles', '/print'], ['Settings', '/settings']]],
];

const Chevron = () => <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>;

const resolvePage = (route) => {
  if (route.startsWith('/sales-orders/')) return SalesOrder;
  if (route.startsWith('/challans/transit')) return ChallanTransit;
  const path = '/' + (route.split('?')[0].split('/')[1] || 'dashboard');
  return {
    '/dashboard': Dashboard,
    '/find': FindDocument,
    '/alerts': Alerts,
    '/sales-orders': SalesOrders,
    '/challans': DeliveryChallan,
    '/invoices': InvoiceConvert,
    '/receipts': Receipts,
    '/ledger': StockLedger,
    '/transfers': Transfers,
    '/adjustments': Adjustments,
    '/items': ItemDetail,
    '/import': BulkImport,
    '/print': PrintPreview,
    '/parties': Parties,
    '/warehouses': Warehouses,
    '/reports': Reports,
    '/settings': Settings,
  }[path];
};

export default function Shell({ route, user, onSignOut }) {
  const [org, setOrg] = useState(null);
  const [godowns, setGodowns] = useState([]);
  const [godown, setGodown] = useState('all');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api('/org'), api('/warehouses')]).then(([o, g]) => {
      if (!alive) return;
      setOrg(o);
      setGodowns(g);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [route]);

  const path = '/' + (route.split('?')[0].split('/')[1] || 'dashboard');
  const Page = resolvePage(route);

  return (
    <div className="gd-app">
      {mobileOpen && <button className="gd-nav-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`gd-side${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="gd-brand"><span className="gd-logo">▣</span><b>Girder</b><i>mock</i></div>
        <nav aria-label="Primary navigation">
          {NAV.map(([group, links]) => (
            <div key={group}>
              <div className="gd-group">{group}</div>
              {links.map(([label, to]) => (
                <a
                  key={to}
                  href={`#${to}`}
                  className={`gd-link${path === to ? ' on' : ''}`}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="gd-user" onClick={onSignOut} title="Sign out">
          <b>{user?.name || 'Harish K.'}</b><span>{user?.role === 'MASTER_ADMIN' ? 'Owner · all godowns' : 'User · all godowns'}</span>
        </div>
      </aside>

      <div className="gd-main">
        <header className="gd-top">
          <button className="gd-mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>☰</button>
          <label className="gd-sel"><small>ORG</small><b>{org?.name || 'Sri Venkateswara Traders'}</b><Chevron /></label>
          <label className="gd-sel"><small>GODOWN</small>
            <select value={godown} onChange={(e) => setGodown(e.target.value)} aria-label="Select godown">
              <option value="all">All godowns</option>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <Chevron />
          </label>
          <div className="gd-search"><span aria-hidden="true">⌕</span><input aria-label="Global search" placeholder="Customer, mobile, GSTIN, doc no." /><kbd>/</kbd></div>
          <span className="gd-spacer" />
          <button className="gd-icon" aria-label="Notifications">🔔</button>
          <button className="gd-icon" aria-label="Help">?</button>
        </header>
        <main className="gd-content">
          {Page ? <Page godown={godown} route={route} user={user} /> : <div className="gd-soon"><h1>{path.slice(1)}</h1><p>This screen is not mapped yet.</p></div>}
        </main>
      </div>
    </div>
  );
}
