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

// Mock DB Storage fallback when Aiven connection fails
let inMemoryOrders = [];
let nextOrderId = 1;
let isDbConnected = false;

// 1. Connection Pool configured with environment variables
const db = mysql.createPool({
    host: process.env.DB_HOST || 'mysql-1c1c57cb-qr-ordering-db.c.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || 'AVNS_MdaZH9dVc3NiCyCbbHb',
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 12017,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

db.getConnection((err, conn) => {
    if (err) {
        console.error('❌ Cloud DB connection failed (Running in Local Fallback Mode):', err.message);
        isDbConnected = false;
    } else {
        console.log('✅ Connected to Aiven Cloud MySQL Database!');
        isDbConnected = true;
        conn.release();
    }
});

// Fallback Menu Data
const defaultMenu = [
    { id: 1, name: 'Cheeseburger', price: 120.00, category: 'BURGERS' },
    { id: 2, name: 'Double Bacon Burger', price: 180.00, category: 'BURGERS' },
    { id: 3, name: 'French Fries', price: 60.00, category: 'SIDES' },
    { id: 4, name: 'Onion Rings', price: 75.00, category: 'SIDES' },
    { id: 5, name: 'Iced Tea', price: 45.00, category: 'DRINKS' },
    { id: 6, name: 'Soda', price: 40.00, category: 'DRINKS' }
];

app.get('/api/menu', (req, res) => {
    if (!isDbConnected) {
        return res.json(defaultMenu);
    }
    db.query('SELECT * FROM menu', (err, results) => {
        if (err || !results.length) return res.json(defaultMenu);
        res.json(results);
    });
});

app.get('/api/orders', (req, res) => {
    if (!isDbConnected) {
        return res.json(inMemoryOrders);
    }
    db.query('SELECT * FROM orders ORDER BY id DESC', (err, results) => {
        if (err) return res.json(inMemoryOrders);
        res.json(results);
    });
});

app.get('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    if (!isDbConnected) {
        const order = inMemoryOrders.find(o => o.id === orderId);
        return order ? res.json(order) : res.status(404).json({ error: 'Order not found' });
    }
    db.query('SELECT * FROM orders WHERE id = ?', [orderId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(results[0]);
    });
});

app.post('/api/orders', (req, res) => {
    const { table_number, total_amount } = req.body;

    if (!isDbConnected) {
        const newOrder = {
            id: nextOrderId++,
            table_number: table_number || 1,
            total_amount: total_amount || 0,
            status: 'Pending',
            created_at: new Date()
        };
        inMemoryOrders.unshift(newOrder);
        return res.json({ message: 'Order placed successfully (Local Mode)', orderId: newOrder.id });
    }

    const sql = 'INSERT INTO orders (table_number, total_amount, status) VALUES (?, ?, ?)';
    db.query(sql, [table_number || 1, total_amount || 0, 'Pending'], (err, result) => {
        if (err) {
            console.error('Error inserting order:', err);
            return res.status(500).json({ error: 'Failed to place order' });
        }
        res.json({ message: 'Order placed successfully!', orderId: result.insertId });
    });
});

app.put('/api/orders/:id/status', (req, res) => {
    const { status } = req.body;
    const orderId = parseInt(req.params.id, 10);

    if (!isDbConnected) {
        const order = inMemoryOrders.find(o => o.id === orderId);
        if (order) order.status = status;
        return res.json({ message: 'Status updated successfully (Local Mode)' });
    }

    db.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId], (err) => {
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