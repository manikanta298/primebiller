import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import BulkImport from './BulkImport';

const apiMock = vi.fn();
vi.mock('../api', () => ({ api: (path, opts) => apiMock(path, opts), base: 'http://api.test' }));

const job = { job: { id: 5, rows_total: 1, status: 'VALIDATED' }, counts: { errors: 0, valid: 1 } };

describe('BulkImport formats', () => {
  beforeEach(() => { apiMock.mockReset(); apiMock.mockImplementation(async (p) => (p.includes('/rows') ? [] : job)); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('uploads an .xlsx file as binary with the xlsx content type', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => job }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<BulkImport route="#/import?type=WAREHOUSES" />);
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'godowns.xlsx');
    file.arrayBuffer = async () => new Uint8Array([80, 75, 3, 4]).buffer;
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [file] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/imports?type=WAREHOUSES&filename=godowns.xlsx');
    expect(opts.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(opts.body).toBeInstanceOf(ArrayBuffer);
  });

  it('sends JSON files as application/json text', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => job }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<BulkImport />);
    const file = new File(['[{"sku":"A"}]'], 'items.json');
    file.text = async () => '[{"sku":"A"}]';
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [file] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('rejects unsupported extensions without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<BulkImport />);
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'old.xls')] } });
    expect(await screen.findByRole('status')).toHaveTextContent('.csv, .xlsx or .json');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('imports from a Google Sheet link', async () => {
    render(<BulkImport route="#/import?type=PARTIES" />);
    fireEvent.change(screen.getByLabelText('Google Sheet link'), { target: { value: 'https://docs.google.com/spreadsheets/d/abc/edit' } });
    fireEvent.click(screen.getByText('Import from Google Sheet'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/imports/from-sheet', expect.objectContaining({ method: 'POST' })));
    expect(JSON.parse(apiMock.mock.calls.find(([p]) => p === '/imports/from-sheet')[1].body)).toEqual({ type: 'PARTIES', url: 'https://docs.google.com/spreadsheets/d/abc/edit' });
  });
});
