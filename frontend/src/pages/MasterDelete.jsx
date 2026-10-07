import React, { useEffect, useState } from 'react';
import { api } from '../api';

// Shared single + bulk delete for the Items, Parties and Warehouses lists.
// `path` is the API collection ("items" | "parties" | "warehouses"), `label` the singular word for messages.
export function useMasterDelete(path, label, rows, reload) {
  const [selected, setSelected] = useState(() => new Set());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Forget selections for rows that are no longer listed (after a delete, search or filter change).
  useEffect(() => {
    setSelected((s) => {
      const live = new Set(rows.map((r) => r.id));
      const next = new Set([...s].filter((id) => live.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [rows]);

  const ids = rows.map((r) => r.id);
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(ids));
  const clear = () => setSelected(new Set());

  const removeOne = async (row) => {
    if (!window.confirm(`Delete ${label} "${row.name || row.sku}"? This cannot be undone.`)) return;
    setBusy(true); setMsg('');
    try { await api(`/${path}/${row.id}`, { method: 'DELETE' }); setMsg(`${label} deleted`); clear(); reload(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const removeSelected = async () => {
    const list = [...selected];
    if (!list.length || !window.confirm(`Delete ${list.length} selected ${label.toLowerCase()}${list.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBusy(true); setMsg('');
    try {
      const r = await api(`/${path}/bulk-delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: list }) });
      const why = [...new Set((r.results || []).filter((x) => !x.ok).map((x) => x.reason))];
      setMsg(`Deleted ${r.deleted}.${r.failed ? ` ${r.failed} could not be deleted: ${why.join('; ')}.` : ''}`);
      clear(); reload();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  return { selected, allChecked, toggle, toggleAll, clear, removeOne, removeSelected, msg, busy };
}

export function DeleteBar({ del, label }) {
  const n = del.selected.size;
  return <>
    {n > 0 && <div className="gd-card gd-filterbar"><div className="gd-filter-row"><span className="gd-grow"><b>{n}</b> {label.toLowerCase()}{n > 1 ? 's' : ''} selected</span><button className="gd-btn" disabled={del.busy} onClick={del.clear}>Clear</button><button className="gd-btn pri" disabled={del.busy} onClick={del.removeSelected}>Delete selected ({n})</button></div></div>}
    {del.msg && <div className="gd-note" role="status">{del.msg}</div>}
  </>;
}

export const SelectAllTh = ({ del, label }) => <th style={{ width: 32 }}><input type="checkbox" aria-label={`Select all ${label.toLowerCase()}s`} checked={del.allChecked} onChange={del.toggleAll} /></th>;
export const SelectTd = ({ del, id, name }) => <td><input type="checkbox" aria-label={`Select ${name}`} checked={del.selected.has(id)} onChange={() => del.toggle(id)} /></td>;
export const DeleteBtn = ({ del, row }) => <button className="gd-btn" disabled={del.busy} onClick={() => del.removeOne(row)} aria-label={`Delete ${row.name || row.sku}`}>Delete</button>;
