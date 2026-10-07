export const base = import.meta.env.VITE_AUTH_URL || 'https://primebiller.onrender.com';
export const api = async (path, opts = {}) => {
  const r = await fetch(`${base}/api${path}`, { credentials: 'include', ...opts });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || r.statusText), { field: body.field, status: r.status });
  }
  return r.json();
};
export const inr = (n, d = 2) => Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
export const lakh = (n) => n >= 1e7 ? `${(n / 1e7).toFixed(2)} Cr` : `${(n / 1e5).toFixed(2)} L`;
export const qty = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
