const router      = require('express').Router();
const pool        = require('../db/pool');
const requireAuth = require('../middleware/auth');

// GET /api/orders — fetch all live orders (public, used by display screens)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, order_number, ready_at FROM orders ORDER BY ready_at ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/orders — add new order (requires auth)
router.post('/', requireAuth, async (req, res) => {
  const { order_number } = req.body;
  if (!order_number || String(order_number).trim() === '')
    return res.status(400).json({ error: 'order_number required' });

  const num = String(order_number).trim();
  const now = new Date();

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Insert into live orders
      const [result] = await conn.query(
        'INSERT INTO orders (order_number, ready_at) VALUES (?, ?)',
        [num, now]
      );

      // Insert into history (collected_at stays NULL until collected)
      await conn.query(
        'INSERT INTO orders_history (order_number, ready_at) VALUES (?, ?)',
        [num, now]
      );

      await conn.commit();

      const newOrder = { id: result.insertId, order_number: num, ready_at: now };

      // Broadcast to all connected clients via Socket.io
      req.app.get('io').emit('order:added', newOrder);

      res.status(201).json(newOrder);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('POST order error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/orders/:id — mark order as collected (requires auth)
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const now = new Date();

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Get the order before deleting
      const [orders] = await conn.query(
        'SELECT id, order_number, ready_at FROM orders WHERE id = ?',
        [id]
      );
      if (!orders.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Order not found' });
      }
      const order = orders[0];

      // Remove from live orders
      await conn.query('DELETE FROM orders WHERE id = ?', [id]);

      // Update history with collected timestamp
      await conn.query(
        `UPDATE orders_history
         SET collected_at = ?
         WHERE order_number = ? AND ready_at = ? AND collected_at IS NULL
         ORDER BY id DESC LIMIT 1`,
        [now, order.order_number, order.ready_at]
      );

      await conn.commit();

      // Broadcast to all clients
      req.app.get('io').emit('order:collected', {
        id: parseInt(id),
        order_number: order.order_number,
        collected_at: now
      });

      res.json({ success: true, collected_at: now });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('DELETE order error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/orders — clear all live orders (requires auth)
router.delete('/', requireAuth, async (req, res) => {
  const now = new Date();
  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Bulk-update all uncollected history rows
      await conn.query(
        `UPDATE orders_history
         SET collected_at = ?
         WHERE collected_at IS NULL
           AND DATE(ready_at) = CURDATE()`,
        [now]
      );

      // Clear live orders
      await conn.query('DELETE FROM orders');

      await conn.commit();

      req.app.get('io').emit('orders:cleared');
      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('DELETE all orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
