import React from 'react';
import { inr } from '../api';

export const dateShort = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const dateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
};

export const Tag = ({ children, tone = 'teal' }) => <span className={`gd-tag t-\${tone}`}>{children}</span>;

export const KpiStrip = ({ items }) => (
  <div className="gd-kpis gd-kpis-4">
    {items.map((x) => (
      <div className="gd-card gd-kpi" key={x.label}>
        <small>{x.label}</small>
        <b style={{ color: x.color }}>{x.value}</b>
        <span>{x.sub}</span>
      </div>
    ))}
  </div>
);

export const FilterBar = ({ children }) => <div className="gd-card gd-filterbar">{children}</div>;

export const Pager = ({ from, to, total, onPrev, onNext, canPrev, canNext }) => (
  <div className="gd-pager">
    <span>{total ? `Showing \${from}–\${to} of \${total}` : 'No results'}</span>
    <div>
      <button className="gd-btn" disabled={!canPrev} onClick={onPrev}>Previous</button>
      <button className="gd-btn" disabled={!canNext} onClick={onNext}>Next</button>
    </div>
  </div>
);

export const Money = ({ value, rupee = true, decimals = 0 }) => <span className="gd-mono">{rupee ? '₹' : ''}{inr(value, decimals)}</span>;
