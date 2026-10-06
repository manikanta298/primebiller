import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MasterFormModal from './MasterFormModal';

const apiMock = vi.fn();
vi.mock('../api', () => ({ api: (path, opts) => apiMock(path, opts) }));

const field = (name) => screen.getByRole(name === 'GST rate %' ? 'spinbutton' : 'textbox', { name });
const fillItem = (values, uom) => {
  for (const [name, value] of Object.entries(values)) fireEvent.change(field(name), { target: { value } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Base UOM' }), { target: { value: uom } });
};

describe('MasterFormModal', () => {
  afterEach(cleanup); // vitest globals are off, so RTL does not auto-clean between tests
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) => path === '/uoms' ? { rows: [{ code: 'BAG' }, { code: 'NOS' }] } : { ok: true, id: 1 });
  });

  it('blocks submit until required fields are filled', async () => {
    render(<MasterFormModal type="ITEMS" onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('SKU is required');
    expect(apiMock).not.toHaveBeenCalledWith('/items', expect.anything());
  });

  it('posts the item and reports success', async () => {
    const onSaved = vi.fn();
    render(<MasterFormModal type="ITEMS" onClose={() => {}} onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Base UOM' })).toHaveTextContent('BAG'));
    fillItem({ SKU: 'CEM-1', 'Item name': 'Cement', 'HSN (4, 6 or 8 digits)': '2523', 'GST rate %': '28' }, 'BAG');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, opts] = apiMock.mock.calls.find(([p]) => p === '/items');
    expect(JSON.parse(opts.body)).toMatchObject({ sku: 'CEM-1', hsn: '2523', gst_rate: '28', base_uom: 'BAG', batch_tracked: true });
  });

  it('shows the server error and highlights the field', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path === '/uoms') return { rows: [] };
      throw Object.assign(new Error('HSN must be 4, 6 or 8 digits'), { field: 'hsn' });
    });
    render(<MasterFormModal type="ITEMS" onClose={() => {}} onSaved={() => {}} />);
    fillItem({ SKU: 'A', 'Item name': 'B', 'HSN (4, 6 or 8 digits)': '12', 'GST rate %': '18' }, 'NOS');
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('HSN must be 4, 6 or 8 digits');
  });
});
