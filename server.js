const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Headers
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static('public', {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

// Anti-Spam Rate Limiter
const requestTracker = new Map();
function orderRateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 15;

    const record = requestTracker.get(ip) || { count: 0, startTime: now };
    if (now - record.startTime > windowMs) {
        record.count = 1;
        record.startTime = now;
    } else {
        record.count++;
    }
    requestTracker.set(ip, record);

    if (record.count > maxRequests) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }
    next();
}

// Local Fallback Storage
let inMemoryOrders = [];
let nextOrderId = 20;
let isDbConnected = false;

// Aiven Cloud MySQL Pool
const db = mysql.createPool({
    host: process.env.DB_HOST || 'mysql-1c1c57cb-qr-ordering-db.c.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || '',
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
        console.error('❌ Cloud DB connection failed (Local Fallback Mode):', err.message);
        isDbConnected = false;
    } else {
        console.log('✅ Connected to Aiven Cloud MySQL Database!');
        isDbConnected = true;
        conn.query("ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50) DEFAULT 'Cash / Counter'", () => {});
        conn.query("ALTER TABLE orders ADD COLUMN items_summary TEXT NULL", () => {});
        conn.release();
    }
});

// Default Menu & Add-ons
const defaultMenu = [
    { id: 1, name: 'Cheeseburger', price: 120.00, category: 'BURGERS', image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&auto=format&fit=crop' },
    { id: 2, name: 'Double Bacon Burger', price: 180.00, category: 'BURGERS', image_url: 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=500&auto=format&fit=crop' },
    { id: 3, name: 'French Fries', price: 60.00, category: 'SIDES', image_url: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500&auto=format&fit=crop' },
    { id: 4, name: 'Onion Rings', price: 75.00, category: 'SIDES', image_url: 'https://images.unsplash.com/photo-1639024471283-03518883512d?w=500&auto=format&fit=crop' },
    { id: 5, name: 'Iced Tea', price: 45.00, category: 'DRINKS', image_url: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop' },
    { id: 6, name: 'Soda', price: 40.00, category: 'DRINKS', image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500&auto=format&fit=crop' }
];

const validAddons = {
    'Extra Cheese': 15.00,
    'Crispy Bacon': 25.00,
    'Upgrade to Large Combo': 45.00
};

// Server-side Price Verification & Summary Builder
async function calculateVerifiedOrder(items) {
    let menuMap = new Map(defaultMenu.map(m => [m.id, m]));

    if (isDbConnected) {
        try {
            const [rows] = await db.promise().query('SELECT id, name, price FROM menu');
            if (rows.length > 0) {
                menuMap = new Map(rows.map(r => [r.id, { id: r.id, name: r.name, price: Number(r.price) }]));
            }
        } catch (e) {
            console.error('Menu verification fallback:', e.message);
        }
    }

    let verifiedTotal = 0;
    const verifiedItems = [];
    const summaryParts = [];

    for (const item of items) {
        const baseId = parseInt(item.baseId || item.id, 10);
        const qty = Math.min(50, Math.max(1, parseInt(item.quantity, 10) || 1));
        const dbProduct = menuMap.get(baseId);

        if (!dbProduct) continue;

        let unitPrice = Number(dbProduct.price);
        let itemLabel = dbProduct.name;

        if (Array.isArray(item.addons) && item.addons.length > 0) {
            const appliedAddons = [];
            for (const addonName of item.addons) {
                if (validAddons[addonName] !== undefined) {
                    unitPrice += validAddons[addonName];
                    appliedAddons.push(addonName);
                }
            }
            if (appliedAddons.length > 0) {
                itemLabel += ` (${appliedAddons.join(', ')})`;
            }
        }

        const lineTotal = unitPrice * qty;
        verifiedTotal += lineTotal;

        verifiedItems.push({
            name: itemLabel,
            price: unitPrice,
            quantity: qty,
            subtotal: lineTotal
        });
        summaryParts.push(`${qty}x ${itemLabel}`);
    }

    return {
        verifiedTotal: Number(verifiedTotal.toFixed(2)),
        verifiedItems,
        itemsSummary: summaryParts.join(', ')
    };
}

// Routes
app.get('/api/menu', (req, res) => {
    if (!isDbConnected) return res.json(defaultMenu);
    db.query('SELECT * FROM menu', (err, results) => {
        if (err || !results.length) return res.json(defaultMenu);
        res.json(results);
    });
});

app.get('/api/orders', (req, res) => {
    if (!isDbConnected) return res.json(inMemoryOrders);
    db.query('SELECT * FROM orders ORDER BY id DESC', (err, results) => {
        if (err) return res.json(inMemoryOrders);
        res.json(results);
    });
});

app.get('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid Order ID' });

    if (!isDbConnected) {
        const order = inMemoryOrders.find(o => o.id === orderId);
        return order ? res.json(order) : res.status(404).json({ error: 'Order not found' });
    }
    db.query('SELECT * FROM orders WHERE id = ?', [orderId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(results[0]);
    });
});

// Place Cash / Counter or Direct QRPh Order
app.post('/api/orders', orderRateLimiter, async (req, res) => {
    const tableNum = Math.min(99, Math.max(1, parseInt(req.body.table_number, 10) || 1));
    const items = req.body.items || [];
    const rawTotal = parseFloat(req.body.total_amount) || 0;
    const payMethod = req.body.payment_method || 'Cash / Pay at Counter';

    let finalTotal = rawTotal;
    let itemsSummary = 'Standard Meal Order';
    let verifiedItems = items;

    if (Array.isArray(items) && items.length > 0) {
        const verified = await calculateVerifiedOrder(items);
        if (verified.verifiedTotal > 0) {
            finalTotal = verified.verifiedTotal;
            itemsSummary = verified.itemsSummary;
            verifiedItems = verified.verifiedItems;
        }
    }

    if (finalTotal <= 0) {
        return res.status(400).json({ error: 'Invalid order total.' });
    }

    if (!isDbConnected) {
        const newOrder = {
            id: nextOrderId++,
            table_number: tableNum,
            total_amount: finalTotal,
            payment_method: payMethod,
            items_summary: itemsSummary,
            status: 'Pending',
            created_at: new Date()
        };
        inMemoryOrders.unshift(newOrder);
        return res.json({
            message: 'Order placed successfully!',
            orderId: newOrder.id,
            verifiedTotal: finalTotal,
            verifiedItems
        });
    }

    const sql = 'INSERT INTO orders (table_number, total_amount, payment_method, items_summary, status) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [tableNum, finalTotal, payMethod, itemsSummary, 'Pending'], (err, result) => {
        if (err) {
            console.error('Error inserting order:', err);
            return res.status(500).json({ error: 'Failed to place order' });
        }
        res.json({
            message: 'Order placed successfully!',
            orderId: result.insertId,
            verifiedTotal: finalTotal,
            verifiedItems
        });
    });
});

app.put('/api/orders/:id/status', (req, res) => {
    const allowedStatuses = ['Pending', 'Preparing', 'Completed', 'Cancelled'];
    const { status } = req.body;
    const orderId = parseInt(req.params.id, 10);

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }

    if (!isDbConnected) {
        const order = inMemoryOrders.find(o => o.id === orderId);
        if (order) order.status = status;
        return res.json({ message: 'Status updated successfully' });
    }

    db.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update status' });
        res.json({ message: 'Status updated successfully' });
    });
});

// PayMongo Online Checkout Endpoint (Includes QRPh, GCash, Maya, Card)
app.post('/api/create-checkout', orderRateLimiter, async (req, res) => {
    const { items, table_number } = req.body;
    const tableNum = Math.min(99, Math.max(1, parseInt(table_number, 10) || 1));

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
    }

    const { verifiedTotal, verifiedItems, itemsSummary } = await calculateVerifiedOrder(items);
    if (verifiedTotal <= 0) {
        return res.status(400).json({ error: 'Invalid order total' });
    }

    let recordedOrderId = Math.floor(1000 + Math.random() * 9000);
    if (isDbConnected) {
        try {
            const [result] = await db.promise().query(
                'INSERT INTO orders (table_number, total_amount, payment_method, items_summary, status) VALUES (?, ?, ?, ?, ?)',
                [tableNum, verifiedTotal, 'Online (PayMongo / QRPh)', itemsSummary, 'Pending']
            );
            recordedOrderId = result.insertId;
        } catch (e) {
            console.error('DB insert before PayMongo failed:', e.message);
        }
    } else {
        recordedOrderId = nextOrderId++;
        inMemoryOrders.unshift({
            id: recordedOrderId,
            table_number: tableNum,
            total_amount: verifiedTotal,
            payment_method: 'Online (PayMongo / QRPh)',
            items_summary: itemsSummary,
            status: 'Pending',
            created_at: new Date()
        });
    }

    const line_items = verifiedItems.map(item => ({
        currency: 'PHP',
        amount: Math.round(item.price * 100),
        name: item.name,
        quantity: item.quantity
    }));

    const PAYMONGO_SECRET_KEY = (process.env.PAYMONGO_SECRET_KEY || '').trim();
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const payload = {
        data: {
            attributes: {
                send_email_receipt: false,
                show_description: true,
                show_line_items: true,
                payment_method_types: ['qrph', 'gcash', 'paymaya', 'card'],
                line_items: line_items,
                description: `ELTEO Table ${tableNum} Order #${recordedOrderId}`,
                success_url: `${baseUrl}/?table=${tableNum}&status=success&orderId=${recordedOrderId}`,
                cancel_url: `${baseUrl}/?table=${tableNum}&status=cancelled`
            }
        }
    };

    try {
        const authHeader = 'Basic ' + Buffer.from(PAYMONGO_SECRET_KEY + ':').toString('base64');
        const response = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data.data?.attributes?.checkout_url) {
            return res.json({
                checkout_url: data.data.attributes.checkout_url,
                orderId: recordedOrderId
            });
        } else {
            console.error('PayMongo API Error Details:', JSON.stringify(data, null, 2));
            return res.status(response.status || 400).json({
                error: 'Failed to create payment session',
                details: data
            });
        }
    } catch (error) {
        console.error('PayMongo Checkout Server Error:', error);
        return res.status(500).json({ error: 'Internal server error processing payment' });
    }
});

// QR Code Generator Route
app.get('/qr/:tableNumber', async (req, res) => {
    const tableNumber = parseInt(req.params.tableNumber, 10) || 1;
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
    console.log(`ELTEO Server running locally on: http://localhost:${PORT}`);
    console.log(`Live Render Production URL: ${baseUrl}`);
    console.log(`==================================================\n`);
});