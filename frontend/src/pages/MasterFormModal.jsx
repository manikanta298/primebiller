import React, { useEffect, useState } from 'react';
import { api } from '../api';

// Field config for the single-entry forms. Keys match the bulk-import columns.
export const FORMS = {
  ITEMS: {
    title: 'New item', path: '/items',
    fields: [
      { k: 'sku', l: 'SKU', req: true }, { k: 'name', l: 'Item name', req: true },
      { k: 'hsn', l: 'HSN (4, 6 or 8 digits)', req: true }, { k: 'gst_rate', l: 'GST rate %', type: 'number', req: true },
      { k: 'base_uom', l: 'Base UOM', type: 'uom', req: true },
      { k: 'valuation', l: 'Valuation', type: 'select', options: ['FIFO', 'WAVG'], def: 'FIFO' },
      { k: 'batch_tracked', l: 'Batch tracked', type: 'bool', def: true },
      { k: 'brand', l: 'Brand' }, { k: 'category', l: 'Category' },
    ],
  },
  WAREHOUSES: {
    title: 'New godown', path: '/warehouses',
    fields: [
      { k: 'name', l: 'Name', req: true }, { k: 'notes', l: 'Notes' },
      { k: 'default_uom', l: 'Default UOM', type: 'uom', def: 'NOS' },
      { k: 'default_reorder', l: 'Reorder point', type: 'number', def: 0 },
      { k: 'max_stock', l: 'Max stock', type: 'number' },
      { k: 'allow_negative', l: 'Allow negative stock', type: 'bool', def: false },
    ],
  },
  PARTIES: {
    title: 'New party', path: '/parties',
    fields: [
      { k: 'name', l: 'Name', req: true },
      { k: 'party_type', l: 'Type', type: 'select', options: ['CUSTOMER', 'SUPPLIER'], def: 'CUSTOMER' },
      { k: 'gstin', l: 'GSTIN' }, { k: 'mobile', l: 'Mobile (10–15 digits)' },
      { k: 'credit_limit', l: 'Credit limit', type: 'number', def: 0 }, { k: 'terms', l: 'Terms', def: 'Net 30' },
      { k: 'status', l: 'Status', type: 'select', options: ['ACTIVE', 'ON_HOLD', 'CREDIT_WATCH'], def: 'ACTIVE' },
      { k: 'preferred', l: 'Preferred', type: 'bool', def: false },
    ],
  },
};

// With `record` the modal edits that record (loaded from GET <path>/<id>, saved with PATCH); without it, it creates one.
export default function MasterFormModal({ type, record, onClose, onSaved }) {
  const cfg = FORMS[type];
  const editing = !!record;
  const [vals, setVals] = useState(() => Object.fromEntries(cfg.fields.map((f) => [f.k, f.def ?? ''])));
  const [uoms, setUoms] = useState([]);
  const [err, setErr] = useState(null); // { message, field }
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const needsUom = cfg.fields.some((f) => f.type === 'uom');

  useEffect(() => {
    if (!needsUom) return;
    api('/uoms').then((d) => setUoms((d.rows || []).map((u) => u.code))).catch(() => setErr({ message: 'Units of measure could not be loaded' }));
  }, [needsUom]);

  useEffect(() => {
    if (!editing) return;
    api(`${cfg.path}/${record.id}`)
      .then((d) => setVals(Object.fromEntries(cfg.fields.map((f) => [f.k, f.type === 'bool' ? d[f.k] === true || d[f.k] === 'true' : (d[f.k] ?? '')]))))
      .catch((e) => setErr({ message: e.message || 'Could not load the record' }))
      .finally(() => setLoading(false));
  }, [editing, record?.id, cfg.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setVals((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    const missing = cfg.fields.find((f) => f.req && !String(vals[f.k] ?? '').trim());
    if (missing) return setErr({ message: `${missing.l} is required`, field: missing.k });
    setBusy(true); setErr(null);
    try {
      await api(editing ? `${cfg.path}/${record.id}` : cfg.path, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vals) });
      onSaved?.();
    } catch (e) {
      setErr({ message: e.message, field: e.field });
    } finally { setBusy(false); }
  };

  const input = (f) => {
    if (f.type === 'bool') return <label className="gd-check"><input type="checkbox" checked={!!vals[f.k]} onChange={(e) => set(f.k, e.target.checked)} /> {f.l}</label>;
    const label = <small>{f.l.toUpperCase()}{f.req ? ' *' : ''}</small>;
    const opts = f.type === 'uom' ? (uoms.length ? uoms : [vals[f.k]].filter(Boolean)) : f.options;
    return <label className={err?.field === f.k ? 'bad' : ''} key={f.k}>{label}
      {opts
        ? <select aria-label={f.l} value={vals[f.k]} onChange={(e) => set(f.k, e.target.value)}>{f.type === 'uom' && !f.def && <option value="">Select…</option>}{opts.map((o) => <option key={o}>{o}</option>)}</select>
        : <input aria-label={f.l} type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} value={vals[f.k]} onChange={(e) => set(f.k, e.target.value)} />}
    </label>;
  };

  const title = editing ? cfg.title.replace(/^New/, 'Edit') : cfg.title;

  return <div className="gd-modal-wrap"><div className="gd-modal" role="dialog" aria-label={title}>
    <div className="gd-ch"><h3>{title}</h3><button className="gd-icon" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="gd-modal-form">{cfg.fields.map((f) => <React.Fragment key={f.k}>{input(f)}</React.Fragment>)}</div>
    {err && <p className="gd-form-err" role="alert">{err.message}</p>}
    <div className="gd-modal-actions"><button className="gd-btn" onClick={onClose}>Cancel</button><button className="gd-btn pri" disabled={busy || loading} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button></div>
  </div></div>;
}
