import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Items from './Items';

const apiMock = vi.fn();
vi.mock('../api', () => ({
  api: (path, opts) => apiMock(path, opts),
  inr: (n) => Number(n || 0).toLocaleString('en-IN'),
}));

const rows = [
  { id: 1, sku: 'A-1', name: 'Alpha', hsn: '2523', gst_rate: 18, base_uom: 'NOS', valuation: 'FIFO', on_hand: 0 },
  { id: 2, sku: 'B-2', name: 'Beta', hsn: '2523', gst_rate: 18, base_uom: 'NOS', valuation: 'FIFO', on_hand: 0 },
];

describe('Items delete', () => {
  afterEach(cleanup);
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path, opts) => {
      if (path.startsWith('/items/list')) return { rows };
      if (path === '/items/bulk-delete') return { ok: true, deleted: 1, failed: 1, results: [{ id: 1, ok: true }, { id: 2, ok: false, reason: 'Item is used in stock or transactions and cannot be deleted' }] };
      return { ok: true };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('deletes a single record after confirmation', async () => {
    render(<Items />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alpha' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/items/1', { method: 'DELETE' }));
  });

  it('does nothing when the confirmation is cancelled', async () => {
    window.confirm.mockReturnValue(false);
    render(<Items />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alpha' }));
    expect(apiMock).not.toHaveBeenCalledWith('/items/1', expect.anything());
  });

  it('bulk-deletes the selected rows and reports the ones that were blocked', async () => {
    render(<Items />);
    await screen.findByLabelText('Select Alpha'); // wait for the list to load
    fireEvent.click(screen.getByLabelText('Select all items'));
    fireEvent.click(screen.getByRole('button', { name: /Delete selected \(2\)/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/items/bulk-delete', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: [1, 2] }) })));
    expect(await screen.findByText(/Deleted 1\. 1 could not be deleted/)).toBeTruthy();
  });
});
