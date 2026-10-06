import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Parties from './Parties';

const apiMock = vi.fn();

vi.mock('../api', () => ({
  api: (path) => apiMock(path),
  inr: (n) => Number(n || 0).toLocaleString('en-IN'),
  lakh: (n) => Number(n || 0).toLocaleString('en-IN'),
}));

describe('Parties filters', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({
      rows: [],
      summary: {
        customers: { n: 2, gst: 1 },
        suppliers: { n: 1, preferred: 1 },
        receivables: { value: 0, n: 0 },
        onHold: { n: 1 },
      },
    });
  });

  it('sends a status filter for On hold', async () => {
    render(<Parties />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/parties/list?search=&type=&status='));
    fireEvent.click(screen.getByRole('button', { name: /On hold/i }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/parties/list?search=&type=&status=ON_HOLD'));
  });
});
