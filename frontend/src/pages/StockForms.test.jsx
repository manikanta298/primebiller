import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import Adjustments from './Adjustments';
import Transfers from './Transfers';
import StockLedger from './StockLedger';

const apiMock = vi.fn();
vi.mock('../api', () => ({
  api: (path, opts) => apiMock(path, opts),
  inr: (n) => String(n ?? 0), lakh: (n) => String(n ?? 0),
  qty: (n) => Number(n).toFixed(3),
}));

const batch = { batch_id: 7, item_id: 3, item: 'Cement 53', sku: 'CEM', batch_no: 'B7', unit_cost: 10, qty_on_hand: 50, qty_reserved: 10, free: 40 };
afterEach(cleanup);
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path, opts) => {
    if (path === '/warehouses') return [{ id: 1, name: 'Main' }, { id: 2, name: 'Branch' }];
    if (path.startsWith('/stock/batches')) return { rows: [batch] };
    if (opts?.method === 'POST') return { id: 9, docNo: 'DOC/26-27/00001' };
    if (path.startsWith('/adjustments')) return { rows: [], summary: {} };
    if (path.startsWith('/transfers')) return { rows: [], summary: {}, selected: null };
    return { rows: [], summary: {}, counts: [] };
  });
});
const posted = () => apiMock.mock.calls.find(([, o]) => o?.method === 'POST');
const dlg = () => within(screen.getByRole('dialog'));   // the page behind the modal has its own 'Godown' filter
const godownsLoaded = () => dlg().findAllByRole('option', { name: 'Main' });
const pickOption = (label, value) => fireEvent.change(dlg().getByLabelText(label), { target: { value } });

describe('inventory action buttons', () => {
  it('New adjustment opens a form and submits a signed quantity', async () => {
    render(<Adjustments />);
    fireEvent.click(await screen.findByText('New adjustment'));
    expect(screen.getByRole('dialog', { name: 'New adjustment' })).toBeTruthy();
    await godownsLoaded();
    pickOption('Godown', '1');
    await waitFor(() => expect(screen.getByRole('option', { name: /Cement 53/ })).toBeTruthy());
    pickOption('Batch', '7');
    fireEvent.change(dlg().getByLabelText('Quantity'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Submit for approval'));
    await waitFor(() => expect(posted()).toBeTruthy());
    const [path, opts] = posted();
    expect(path).toBe('/adjustments');
    expect(JSON.parse(opts.body)).toMatchObject({ warehouseId: 1, itemId: 3, batchId: 7, qty: -5, reason: 'Count correction', value: 50 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('New adjustment refuses to take more than the free quantity', async () => {
    render(<Adjustments />);
    fireEvent.click(await screen.findByText('New adjustment'));
    await godownsLoaded();
    pickOption('Godown', '1');
    await waitFor(() => screen.getByRole('option', { name: /Cement 53/ }));
    pickOption('Batch', '7');
    fireEvent.change(dlg().getByLabelText('Quantity'), { target: { value: '41' } });
    fireEvent.click(screen.getByText('Submit for approval'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/free/);
    expect(posted()).toBeUndefined();
  });

  it('New transfer builds lines and sends them', async () => {
    render(<Transfers />);
    fireEvent.click(await screen.findByText('New transfer'));
    await godownsLoaded();
    pickOption('From godown', '1'); pickOption('To godown', '2');
    await waitFor(() => screen.getByRole('option', { name: /Cement 53/ }));
    pickOption('Batch', '7');
    fireEvent.change(dlg().getByLabelText('Quantity'), { target: { value: '15' } });
    fireEvent.click(screen.getByText('Add line'));
    expect(screen.getByText('B7')).toBeTruthy();
    fireEvent.click(screen.getByText('Send now'));
    await waitFor(() => expect(posted()).toBeTruthy());
    const [path, opts] = posted();
    expect(path).toBe('/transfers');
    expect(JSON.parse(opts.body)).toEqual({ fromWarehouseId: 1, toWarehouseId: 2, issue: true, lines: [{ itemId: 3, batchId: 7, qty: 15 }] });
  });

  it('New transfer needs two different godowns and at least one line', async () => {
    render(<Transfers />);
    fireEvent.click(await screen.findByText('New transfer'));
    fireEvent.click(screen.getByText('Send now'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/two different godowns/);
    expect(posted()).toBeUndefined();
  });

  it('New movement offers the documents that post stock', async () => {
    render(<StockLedger godown="" />);
    fireEvent.click(await screen.findByText('New movement'));
    expect(screen.getByRole('dialog', { name: 'New movement' })).toBeTruthy();
    fireEvent.click(screen.getByText(/Stock transfer between godowns/));
    expect(await screen.findByRole('dialog', { name: 'New transfer' })).toBeTruthy();
  });
});
