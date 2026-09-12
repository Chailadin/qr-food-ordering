const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection targeting Aiven MySQL as default
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'mysql-1c1c57cb-qr-ordering-db.c.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || 'AVNS_MdaZH9dVc3NiCyCbbHb',
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 12017,
    ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
    if (err) console.error('Database connection failed:', err);
    else console.log('Connected to Aiven Cloud MySQL Database!');
});

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

app.get('/api/menu', (req, res) => {
    db.query('SELECT * FROM menu', (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch menu' });
        res.json(results);
    });
});

app.get('/api/orders', (req, res) => {
    db.query('SELECT * FROM orders ORDER BY id DESC', (err, results) => {
        if (err) {
            console.error('Error fetching orders:', err);
            return res.status(500).json({ error: 'Failed to fetch orders' });
        }
        res.json(results);
    });
});

app.get('/api/orders/:id', (req, res) => {
    db.query('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(results[0]);
    });
});

app.post('/api/orders', (req, res) => {
    const { table_number, total_amount } = req.body;
    
    // Parameterized query prevents ER_BAD_FIELD_ERROR with string quotes
    const sql = 'INSERT INTO orders (table_number, total_amount, status) VALUES (?, ?, ?)';
    
    db.query(sql, [table_number || 1, total_amount || 0, 'Pending'], (err, result) => {
        if (err) {
            console.error('Error inserting order:', err);
            return res.status(500).json({ error: 'Failed to place order' });
        }
        
        res.json({ 
            message: 'Order placed successfully!', 
            orderId: result.insertId 
        });
    });
});

app.put('/api/orders/:id/status', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update status' });
        res.json({ message: 'Status updated successfully' });
    });
});

app.get('/qr/:tableNumber', async (req, res) => {
    const tableNumber = req.params.tableNumber;
    const baseUrl = process.env.BASE_URL || 'https://qr-food-ordering-app.onrender.com';
    const targetUrl = `${baseUrl}/?table=${tableNumber}`;

    try {
        const qrBuffer = await QRCode.toBuffer(targetUrl);
        res.type('png');
        res.send(qrBuffer);
    } catch (err) {
        console.error('QR Generation Error:', err);
        res.status(500).send('Error generating QR Code');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    const baseUrl = process.env.BASE_URL || 'https://qr-food-ordering-app.onrender.com';
    console.log(`\n==================================================`);
    console.log(`Server running locally on: http://localhost:${PORT}`);
    console.log(`Live Render Production URL: ${baseUrl}`);
    console.log(`Test QR Code (Table 2): http://localhost:${PORT}/qr/2`);
    console.log(`==================================================\n`);
});