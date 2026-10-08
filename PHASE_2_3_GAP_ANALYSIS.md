# Phase 2 & 3 Gap Analysis

Audit of branch `feat/phase3-sales` (includes Phase 2) against the two spec files. Priority: **P0** blocks real use or risks wrong data/security · **P1** needed to finish the phase · **P2** polish/debt.

**State in one line:** Phase 2 and the Phase 3 **backend** are done and tested (66/68 backend tests; the 2 failures are one pre-existing test hard-coded to `org_id=1`). Phase 3 **UI is not done**: the Sales screens are still the original demo screens and do not use the new endpoints.

---
## 1. Missing / incomplete UI screens

### Sales (Phase 3) — sidebar structure must stay unchanged; use modals/drawers
- [ ] **P0 Delivery challans (`/challans`)** is hard-wired to `/sales-orders/current` (demo order `SO/25-26/00042`). On any real database it errors. Needs a challan **list**, then open/create-from-order.
- [ ] **P0 Tax invoices (`/invoices`)** is only a converter that picks the first customer with delivered challans. Needs an invoice **list**, **detail** (source SO/DC, tax breakdown incl. IGST, payment status, linked receipts, print action), **Cancel**, due-date edit.
- [ ] **P0 Receipts (`/receipts`)** is read-only. No form to **post a receipt**, **record an advance**, **allocate an advance** to invoices, or **cancel**; no receipt detail.
- [ ] **P1 Sales order create:** no "New order" (`POST /sales-orders`); the screen only opens the demo order or an existing id. Missing fields in UI: reference, notes.
- [ ] **P1 Sales order detail:** no Cancel, no Reserve/top-up, no reservation-by-batch view, no linked-challans list, no "Create delivery challan" action.
- [ ] **P1 Challan detail:** no source-order link, no Cancel (draft), no Mark delivered (`/deliver`), no "Create invoice" / linked-invoice shortcut.
- [ ] **P1 Order → Challan, Challan → Invoice, Invoice → Receipt** compact modals (spec §4).
- [ ] **P2 Status labels:** UI does not show `RESERVED/PARTIALLY_RESERVED`; needs a derived badge from `/reservations`.

### Inventory (Phase 2)
- [ ] **P1 Item × godown settings editor:** `ItemDetail` shows reorder/max read-only; no way to edit them (no API either, see §2).
- [ ] **P2** Godown screen does not show how many items were auto-synced.

---
## 2. Unfinished backend logic

### Security & correctness (P0)
- [ ] **`ownerOverride` is a client-supplied flag** on `POST /sales-orders/:id/confirm`; anyone can bypass the credit limit. Needs role check (Owner/Master admin) from the session.
- [ ] **Tenant isolation gaps on older routes:** challan transit/e-way routes (`/challans/:id/transit`, `/ewb/*`), `/items/search`, print preview query by id without `org_id`.
- [ ] **Demo hard-codes still in live paths:** `/sales-orders/current`, `/challans/transit/current`, print preview and pending-screen labels key off `SO/25-26/00042`, `DC/25-26/00118`, `RCT/25-26/00079`, etc.
- [ ] **Financial year still hard-coded `25-26`** for transfers (`XFR`) and adjustments (`ADJ`) in `pending.js`; both also use `MAX(doc_no)+1` (spec §33 forbids it; race-prone). Move to `nextDocNo`.
- [ ] **Credit check runs outside the confirm transaction** (read, then lock); two concurrent confirms can both pass.
- [ ] **E-way bill is a stub** (random number, no GSP call).

### Phase 3 logic not built
- [ ] **P1 Reversal of a dispatched challan** (sales return): cancel is refused after dispatch. Needs a ledger movement type (the `stock_ledger.movement` enum has no `DC_RETURN`/`SALES_RETURN`), stock back-in, `qty_sent` rollback, and reservation handling.
- [ ] **P1 Challan statuses** `PARTIALLY_DELIVERED`, `RETURNED` from the spec do not exist.
- [ ] **P1 Order statuses** differ from spec by design (`PARTIAL`, `DELIVERED`, `INVOICED` kept to avoid breaking screens). Decide whether to rename.
- [ ] **P1 Draft receipts / `POST /receipts/:id/post`** not implemented (receipts post on creation).
- [ ] **P1 Editing a confirmed order** (qty change) is blocked; no amend/re-reserve flow.
- [ ] **P2** Receipt `mode` enum limited to NEFT/Cheque/Cash/UPI; cheque clearing state is a demo label.
- [ ] **P2** Invoice `PUT` only edits the due date.
- [ ] **P2** Reports/dashboards still include cancelled invoices in some queries (`pending.js` outstanding/GSTR blocks); only monthly sales was patched.
- [ ] **P2** Allocating an advance at invoice issue cannot be told apart from a later payment when cancelling (uses `advance_adjusted` as the marker).

### Phase 2 logic not built
Spec Phase 2 (§36) is *Opening stock*; what was delivered is the master-sync (§32/§34-6). Still open:
- [ ] **P1 Opening stock** posting (API + UI), batch creation, import.
- [ ] **P1 Edit API for `item_warehouse_settings`** (reorder, max, and the spec's safety stock, reorder multiple, lead time, preferred supplier, active). The table only has `reorder_point` and `max_qty` today.
- [ ] **P1 Reconciliation check** batch vs ledger (spec §28) and a negative-available integrity check (§27).
- [ ] **P2** Godown `active` toggle does not add/remove settings rows; godown `active_skus` is seeded demo data, not computed.
- [ ] **P2** Spec tables not created: `inventory_transactions(+lines)`, `stock_counts(+lines)`, `stock_reservations` (replaced by `so_reservations`), `stock_transfer_events`.
- [ ] **P2** Alerts: `stock_alerts` kinds lack `OVERSTOCK/EXPIRED/...`; no job refreshes them.

---
## 3. Missing integrations
- [ ] Sales dispatch and Transfers/Adjustments use **different posting code**; spec wants one central inventory posting service (`services/inventory/inventoryPosting.js`).
- [ ] Print profile for invoices still renders the demo preview, not a chosen invoice id.
- [ ] Find-a-document opens by demo labels; cancelled documents now show `CANCELLED` but have no detail link for new statuses.
- [ ] Dashboard "awaiting payment/overdue" now exclude cancelled (balance 0) but have not been re-verified against receipts cancellation.

---
## 4. Edge cases still open
- [ ] Order qty in a non-base UOM (no conversion; qty treated as base unit).
- [ ] Expired batches are skipped for reservation but a batch expiring between confirm and dispatch is still dispatched.
- [ ] Two draft challans for one order are prevented by "get-or-create", but a manual second draft is not possible; splitting a dispatch across vehicles needs a flow.
- [ ] Dispatch of unreserved stock (partial reservation + allow-negative godown) has no UI warning.
- [ ] Rounding: invoice tax is rounded per GST rate; challan/order totals per line. Differences of ₹0.01 are possible.
- [ ] Receipt cancel restores the invoice but not an advance's original party-level history beyond status.

---
## 5. Test & tooling debt
- [ ] **P0** No frontend tests for any new Sales behaviour (UI not built yet).
- [ ] **P1** `test/pending.integration.test.js` hard-codes `org_id=1`; seed script fails if `stock_adjustments` rows exist (not in its delete list).
- [x] ~~No CI workflow~~ (correction: `.github/workflows/ci.yml` exists and runs backend + frontend jobs on MySQL 8.4 / Node 24). Still open: CI has never run the new Sales UI because it doesn't exist yet.
- [ ] **P2** Test files run in parallel on one database; use a schema per test file.

---
## 6. Suggested order before Phase 4
1. P0 security: owner-override role check, tenant filters, remove demo hard-codes.
2. P0 UI: challans list, invoices list/detail, receipts form (wired to the new endpoints).
3. P1: sales order create/cancel/reserve UI, conversion modals, settings editor + API.
4. P1: sales return/reversal + ledger movement types; opening stock.
5. P2 items and CI.
