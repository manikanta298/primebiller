// Stock reservations for sales order lines. A reservation raises batches.qty_reserved only; physical
// qty_on_hand changes at dispatch. Every hold is recorded in so_reservations so it can be released or
// consumed exactly. All functions run on the caller's transaction connection.
const EPS = 0.0005;
export const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

// Reserves whatever is still unreserved for the line (FIFO by manufacture date, expired batches skipped).
// Idempotent: calling it again only reserves the remaining shortfall. Returns { held, shortfall }.
export async function reserveLine(c, line) {
  const [[{ held }]] = await c.query("SELECT COALESCE(SUM(qty),0) held FROM so_reservations WHERE so_line_id=?", [line.id]);
  let need = r3(line.qty - line.qty_sent - held), got = 0;
  if (need > EPS) {
    const [bs] = await c.query(`SELECT id,qty_on_hand-qty_reserved free FROM batches WHERE item_id=? AND warehouse_id=? AND qty_on_hand>qty_reserved
      AND (expiry_date IS NULL OR expiry_date>=CURDATE()) ORDER BY mfg_date,id FOR UPDATE`, [line.item_id, line.warehouse_id]);
    for (const b of bs) {
      const take = r3(Math.min(need, b.free));
      if (take <= EPS) continue;
      await c.query("UPDATE batches SET qty_reserved=qty_reserved+? WHERE id=?", [take, b.id]);
      await c.query("INSERT INTO so_reservations (so_line_id,batch_id,qty) VALUES (?,?,?) ON DUPLICATE KEY UPDATE qty=qty+?", [line.id, b.id, take, take]);
      need = r3(need - take); got = r3(got + take);
      if (need <= EPS) break;
    }
  }
  return { held: r3(held + got), shortfall: Math.max(0, need) };
}

// Gives back every reservation of an order (cancel).
export async function releaseOrder(c, soId) {
  const [rows] = await c.query("SELECT r.id,r.batch_id,r.qty FROM so_reservations r JOIN sales_order_lines l ON l.id=r.so_line_id WHERE l.so_id=? FOR UPDATE", [soId]);
  for (const x of rows) await c.query("UPDATE batches SET qty_reserved=GREATEST(qty_reserved-?,0) WHERE id=?", [x.qty, x.batch_id]);
  await c.query("DELETE r FROM so_reservations r JOIN sales_order_lines l ON l.id=r.so_line_id WHERE l.so_id=?", [soId]);
}

// Dispatch: turns up to `qty` of the line's reservation into issued stock (reservation rows shrink,
// batches.qty_reserved drops). Returns the quantity that was actually reserved.
export async function consumeReservation(c, soLineId, qty) {
  const [rows] = await c.query("SELECT id,batch_id,qty FROM so_reservations WHERE so_line_id=? ORDER BY id FOR UPDATE", [soLineId]);
  let left = qty;
  for (const x of rows) {
    const take = r3(Math.min(left, x.qty));
    if (take <= EPS) continue;
    await c.query("UPDATE batches SET qty_reserved=GREATEST(qty_reserved-?,0) WHERE id=?", [take, x.batch_id]);
    if (r3(x.qty - take) <= EPS) await c.query("DELETE FROM so_reservations WHERE id=?", [x.id]);
    else await c.query("UPDATE so_reservations SET qty=qty-? WHERE id=?", [take, x.id]);
    left = r3(left - take);
    if (left <= EPS) break;
  }
  return r3(qty - left);
}
