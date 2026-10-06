import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from './Settings';

const apiMock=vi.fn();
vi.mock('../api',()=>({
  api:(path,opts)=>apiMock(path,opts),
  inr:(n)=>Number(n||0).toLocaleString('en-IN')
}));

describe('Settings component',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    const payload={
      org:{name:'Sri Venkateswara Traders',gstin:'36AABCS1429B1ZQ',state_code:'36',address:'Plot 14',require_credit_override:0,require_batch_reason:1,eway_threshold:50000},
      warehouses:[{id:1,name:'Balanagar Godown',allow_negative:false,default_uom:'BAG',default_reorder:500,max_stock:3000}],
      counters:[{doc_type:'INV',fy:'25-26',last_no:317}]
    };
    apiMock.mockImplementation((path)=>path==='/settings'
      ? Promise.resolve(payload)
      : Promise.resolve({ok:true}));
  });

  it('loads organization controls and saves changes',async()=>{
    render(<Settings/>);
    await waitFor(()=>expect(screen.getByDisplayValue('Sri Venkateswara Traders')).toBeInTheDocument());
    const toggles=screen.getAllByRole('checkbox');
    expect(toggles[2]).not.toBeChecked();
    expect(toggles[3]).toBeChecked();
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/settings',expect.objectContaining({method:'PUT'})));
    expect(screen.getByText(/Changes saved|saved and audited/i)).toBeInTheDocument();
  });
});
