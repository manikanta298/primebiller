import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import DataReset from './DataReset';

const apiMock = vi.fn();
vi.mock('../api', () => ({ api: (path, opts) => apiMock(path, opts) }));

const preview = { confirmPhrase: 'DELETE TEST DATA', scopes: {
  transactions: { label: 'Transactions and stock only', tables: [{ table: 'invoices', count: 4 }, { table: 'batches', count: 0 }] },
  all: { label: 'Everything (also items, parties and godowns)', tables: [{ table: 'invoices', count: 4 }, { table: 'items', count: 9 }] },
} };

describe('DataReset', () => {
  beforeEach(() => { apiMock.mockReset(); apiMock.mockImplementation(async (p, o) => (o?.method === 'POST' ? { ok: true, deleted: [{ table: 'invoices', count: 4 }] } : preview)); });
  afterEach(cleanup);

  it('keeps delete disabled until the phrase is typed, then posts the chosen scope', async () => {
    render(<DataReset />);
    const button = await screen.findByRole('button', { name: 'Delete 4 rows' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'delete test' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'DELETE TEST DATA' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Deleted 4 rows.'));
    const post = apiMock.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(JSON.parse(post[1].body)).toEqual({ scope: 'transactions', confirm: 'DELETE TEST DATA' });
  });

  it('shows larger counts when everything is selected', async () => {
    render(<DataReset />);
    fireEvent.click(await screen.findByLabelText(/Everything/));
    expect(await screen.findByRole('button', { name: 'Delete 13 rows' })).toBeDisabled();
  });

  it('shows a permission error for non-admins', async () => {
    apiMock.mockImplementation(async () => { throw new Error('Only the master admin can delete data'); });
    render(<DataReset />);
    expect(await screen.findByRole('status')).toHaveTextContent('Only the master admin');
  });
});
