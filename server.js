const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
// Use Render's dynamic port, or fallback to 3000 locally
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection using environment variables with local fallbacks
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'qr_ordering_db',
    port: process.env.DB_PORT || 3306
});

db.connect((err) => {
    if (err) console.error('Database connection failed:', err);
    else console.log('Connected to MySQL Database!');
});

// Helper function to auto-detect local network IP (for local testing)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '192.168.1.6';
}

// Get Menu Items
app.get('/api/menu', (req, res) => {
    db.query('SELECT * FROM menu', (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch menu' });
        res.json(results);
    });
});

// Get All Orders (for Staff Dashboard)
app.get('/api/orders', (req, res) => {
    db.query('SELECT * FROM orders ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch orders' });
        res.json(results);
    });
});

// Get Single Order Status (for Customer Tracking)
app.get('/api/orders/:id', (req, res) => {
    db.query('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(results[0]);
    });
});

// Place Order
app.post('/api/orders', (req, res) => {
    const { table_number, total_amount } = req.body;
    const sql = 'INSERT INTO orders (table_number, total_amount, status) VALUES (?, ?, "Pending")';
    db.query(sql, [table_number, total_amount], (err, result) => {
        if (err) return res.status(500).json({ error: 'Failed to place order' });
        res.json({ message: 'Order placed successfully!', orderId: result.insertId });
    });
});

// Update Order Status (for Staff Dashboard)
app.put('/api/orders/:id/status', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update status' });
        res.json({ message: 'Status updated successfully' });
    });
});

// Serve Dynamic QR Code as a Direct PNG Image
app.get('/qr/:tableNumber', async (req, res) => {
    const tableNumber = req.params.tableNumber;
    
    // Automatically use host header on production (Render), or local IP on localhost
    const hostHeader = req.get('host');
    const targetUrl = hostHeader.includes('localhost') 
        ? `http://${getLocalIP()}:${PORT}/?table=${tableNumber}`
        : `${req.protocol}://${hostHeader}/?table=${tableNumber}`;

    try {
        const qrBuffer = await QRCode.toBuffer(targetUrl);
        res.type('png');
        res.send(qrBuffer);
    } catch (err) {
        res.status(500).send('Error generating QR Code');
    }
});

// Listen on process.env.PORT or default 3000
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});