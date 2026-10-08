import React, { useEffect, useState } from 'react';
import { api, qty as fmtQty } from '../api';

const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const REASONS = ['Count correction', 'Damage', 'Expiry write-off', 'Opening balance', 'Other'];

const Shell = ({ title, onClose, err, children, actions }) => (
  <div className="gd-modal-wrap"><div className="gd-modal" role="dialog" aria-label={title}>
    <div className="gd-ch"><h3>{title}</h3><button className="gd-icon" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="gd-modal-form">{children}</div>
    {err && <p className="gd-form-err" role="alert">{err}</p>}
    <div className="gd-modal-actions"><button className="gd-btn" onClick={onClose}>Cancel</button>{actions}</div>
  </div></div>
);
const Field = ({ label, children }) => <label><small>{label.toUpperCase()}</small>{children}</label>;

// Godown list + the batches of one godown (re-fetched when the godown or search changes).
const useGodowns = () => { const [g, setG] = useState([]); useEffect(() => { api('/warehouses').then(setG).catch(() => setG([])); }, []); return g; };
const useBatches = (wh, search, inStock) => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!wh) return setRows([]);
    let live = true;
    api(`/stock/batches?warehouse_id=${wh}&search=${encodeURIComponent(search)}${inStock ? '&in_stock=1' : ''}`).then((d) => live && setRows(d.rows)).catch(() => live && setRows([]));
    return () => { live = false; };
  }, [wh, search, inStock]);
  return rows;
};
const batchLabel = (b) => `${b.item} · ${b.batch_no} · free ${fmtQty(b.free)}`;

export function AdjustmentModal({ onClose, onDone }) {
  const godowns = useGodowns();
  const [f, setF] = useState({ wh: '', search: '', batchId: '', dir: 'DOWN', qty: '', reason: REASONS[0] });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const batches = useBatches(f.wh, f.search, false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const batch = batches.find((b) => String(b.batch_id) === String(f.batchId));
  const submit = async () => {
    const n = Number(f.qty);
    if (!f.wh || !batch) return setErr('Select a godown and a batch');
    if (!(n > 0)) return setErr('Quantity must be above zero');
    if (f.dir === 'DOWN' && n > batch.free) return setErr(`Only ${fmtQty(batch.free)} free in this batch`);
    setBusy(true); setErr('');
    try {
      const signed = f.dir === 'DOWN' ? -n : n;
      const out = await post('/adjustments', { warehouseId: Number(f.wh), itemId: batch.item_id, batchId: batch.batch_id, qty: signed, reason: f.reason, value: Math.round(n * batch.unit_cost * 100) / 100 });
      onDone(`${out.docNo} submitted for approval`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return <Shell title="New adjustment" onClose={onClose} err={err} actions={<button className="gd-btn pri" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Submit for approval'}</button>}>
    <Field label="Godown"><select aria-label="Godown" value={f.wh} onChange={(e) => setF({ ...f, wh: e.target.value, batchId: '' })}><option value="">Select…</option>{godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
    <Field label="Find item or batch"><input aria-label="Find item or batch" value={f.search} onChange={(e) => set('search', e.target.value)} /></Field>
    <Field label="Batch"><select aria-label="Batch" value={f.batchId} onChange={(e) => set('batchId', e.target.value)}><option value="">Select…</option>{batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{batchLabel(b)}</option>)}</select></Field>
    <Field label="Direction"><select aria-label="Direction" value={f.dir} onChange={(e) => set('dir', e.target.value)}><option value="DOWN">Decrease stock</option><option value="UP">Increase stock</option></select></Field>
    <Field label="Quantity"><input aria-label="Quantity" type="number" min="0" value={f.qty} onChange={(e) => set('qty', e.target.value)} /></Field>
    <Field label="Reason"><select aria-label="Reason" value={f.reason} onChange={(e) => set('reason', e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
  </Shell>;
}

export function TransferModal({ onClose, onDone }) {
  const godowns = useGodowns();
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [search, setSearch] = useState('');
  const [pick, setPick] = useState(''), [q, setQ] = useState(''), [lines, setLines] = useState([]);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const batches = useBatches(from, search, true);
  const add = () => {
    const b = batches.find((x) => String(x.batch_id) === String(pick)), n = Number(q);
    if (!b) return setErr('Select a batch to add');
    if (!(n > 0)) return setErr('Quantity must be above zero');
    const already = lines.find((l) => l.batch_id === b.batch_id)?.qty || 0;
    if (already + n > b.free) return setErr(`Only ${fmtQty(b.free)} free in this batch`);
    setErr(''); setLines([...lines.filter((l) => l.batch_id !== b.batch_id), { ...b, qty: already + n }]); setPick(''); setQ('');
  };
  const submit = async (issue) => {
    if (!from || !to || from === to) return setErr('Choose two different godowns');
    if (!lines.length) return setErr('Add at least one line');
    setBusy(true); setErr('');
    try {
      const out = await post('/transfers', { fromWarehouseId: Number(from), toWarehouseId: Number(to), issue, lines: lines.map((l) => ({ itemId: l.item_id, batchId: l.batch_id, qty: l.qty })) });
      onDone(`${out.docNo} ${issue ? 'sent — receive it at the destination to complete' : 'saved as draft'}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const gsel = (v, set, label, other) => <Field label={label}><select aria-label={label} value={v} onChange={(e) => { set(e.target.value); if (label === 'From godown') { setLines([]); setPick(''); } }}><option value="">Select…</option>{godowns.filter((g) => String(g.id) !== String(other)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>;
  return <Shell title="New transfer" onClose={onClose} err={err} actions={<>
    <button className="gd-btn" disabled={busy} onClick={() => submit(false)}>Save as draft</button>
    <button className="gd-btn pri" disabled={busy} onClick={() => submit(true)}>{busy ? 'Saving…' : 'Send now'}</button></>}>
    {gsel(from, setFrom, 'From godown', to)}{gsel(to, setTo, 'To godown', from)}
    <Field label="Find item or batch"><input aria-label="Find item or batch" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
    <Field label="Batch"><select aria-label="Batch" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Select…</option>{batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{batchLabel(b)}</option>)}</select></Field>
    <Field label="Quantity"><input aria-label="Quantity" type="number" min="0" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
    <button className="gd-btn" type="button" onClick={add}>Add line</button>
    {lines.length > 0 && <table className="gd-t"><thead><tr><th>ITEM</th><th>BATCH</th><th className="gd-r">QTY</th><th /></tr></thead>
      <tbody>{lines.map((l) => <tr key={l.batch_id}><td>{l.item}</td><td>{l.batch_no}</td><td className="gd-r">{fmtQty(l.qty)}</td>
        <td><button className="gd-icon" aria-label={`Remove ${l.item}`} onClick={() => setLines(lines.filter((x) => x.batch_id !== l.batch_id))}>×</button></td></tr>)}</tbody></table>}
  </Shell>;
}

// The ledger is written only by documents, so "New movement" asks which document to raise.
export function MovementChooser({ onClose, onPick }) {
  return <Shell title="New movement" onClose={onClose} actions={null}>
    <p>Stock movements are posted by documents. Choose the one to raise:</p>
    <button className="gd-btn pri" onClick={() => onPick('adjustment')}>Stock adjustment (count, damage, expiry)</button>
    <button className="gd-btn pri" onClick={() => onPick('transfer')}>Stock transfer between godowns</button>
    <p><small>Purchases and sales post stock automatically from their own screens.</small></p>
  </Shell>;
}
