import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SalesOrders from './SalesOrders';

const apiMock=vi.fn();

vi.mock('../api',()=>({
  api:(path)=>apiMock(path),
  inr:(n)=>Number(n||0).toLocaleString('en-IN'),
  lakh:(n)=>(Number(n||0)/100000).toFixed(2)+' L'
}));

describe('SalesOrders component',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    apiMock.mockResolvedValue({
      total:101,nextCursor:null,
      summary:{
        draft:{count:9,value:712400},
        confirmed:{count:24,value:4186300},
        partial:{count:19,value:2240110},
        awaiting:{count:38,value:5671540}
      },
      tabs:[
        {status:'DRAFT',n:9},{status:'CONFIRMED',n:24},{status:'PARTIAL',n:19},
        {status:'DELIVERED',n:11},{status:'CANCELLED',n:7}
      ],
      rows:[{
        id:42,doc_no:'SO/25-26/00042',order_date:'2026-09-22',customer:'Rajesh Constructions',
        gstin:'36AAJCR8821K1Z4',godown:'Balanagar Godown',line_count:4,total:451440,delivered_pct:0,status:'DRAFT'
      }]
    });
  });

  it('renders the mock-driven list hierarchy and KPI values',async()=>{
    render(<SalesOrders godown="all"/>);
    expect(screen.getByRole('heading',{name:'Sales orders'})).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByText('SO/25-26/00042')).toBeInTheDocument());
    expect(screen.getByText('DRAFT ORDERS')).toBeInTheDocument();
    expect(screen.getByText('CONFIRMED - STOCK HELD')).toBeInTheDocument();
    expect(screen.getByText('Rajesh Constructions')).toBeInTheDocument();
  });
});
