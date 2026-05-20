require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const ordersRouter  = require('./routes/orders');
const reportsRouter = require('./routes/reports');
const authRouter    = require('./routes/auth');
const usersRouter   = require('./routes/users');
const { initSocket } = require('./socket/orderEvents');

const app    = express();
const server = http.createServer(app);

// Socket.io — real-time updates to all clients
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Make io available to route handlers
app.set('io', io);

// Routes
app.use('/api/auth',    authRouter);
app.use('/api/users',   usersRouter);
app.use('/api/orders',  ordersRouter);
app.use('/api/reports', reportsRouter);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Socket.io connection handling
initSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🍔 Fergburger server running on port ${PORT}`);
});

// Auto-run schema on startup
async function initDB() {
  try {
    const pool = require('./db/pool');
    await pool.execute('CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, order_number VARCHAR(10) NOT NULL, ready_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await pool.execute('CREATE TABLE IF NOT EXISTS orders_history (id INT AUTO_INCREMENT PRIMARY KEY, order_number VARCHAR(10) NOT NULL, ready_at DATETIME NOT NULL, collected_at DATETIME DEFAULT NULL)');
    await pool.execute('CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await pool.execute("INSERT IGNORE INTO users (username, password_hash) VALUES ('admin', '$2b$10$ycXyg.ouPaXJoehnKisQxOilnH1.PO4FmZHnfCMjk5MXS/Po505ci')");
    console.log('✅ DB schema ready');
  } catch(e) { console.error('DB init error:', e.message); }
}
initDB();
