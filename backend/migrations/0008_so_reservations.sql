-- Per-batch stock reservations for sales order lines, so a cancel or dispatch releases exactly what was held.
CREATE TABLE IF NOT EXISTS so_reservations (
  id INT AUTO_INCREMENT PRIMARY KEY, so_line_id INT NOT NULL, batch_id INT NOT NULL, qty DECIMAL(14,3) NOT NULL,
  UNIQUE KEY uq_so_res (so_line_id, batch_id),
  FOREIGN KEY (so_line_id) REFERENCES sales_order_lines(id) ON DELETE CASCADE, FOREIGN KEY (batch_id) REFERENCES batches(id)
);
ALTER TABLE sales_orders ADD COLUMN reference VARCHAR(40) NULL;
ALTER TABLE sales_orders ADD COLUMN notes VARCHAR(255) NULL;
