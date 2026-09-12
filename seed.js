const mysql = require('mysql2/promise');

async function fixAllTables() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'mysql-1c1c57cb-qr-ordering-db.c.aivencloud.com',
    port: process.env.DB_PORT || 12017,
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || 'AVNS_MdaZH9dVc3NiCyCbbHb',
    database: process.env.DB_NAME || 'defaultdb',
    ssl: { rejectUnauthorized: false }
  });

  console.log("Connected to Aiven MySQL!");

  // Drop old tables
  await connection.query(`DROP TABLE IF EXISTS orders;`);
  await connection.query(`DROP TABLE IF EXISTS menu;`);

  // Create menu table
  await connection.query(`
    CREATE TABLE menu (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      category VARCHAR(100),
      image_url VARCHAR(255)
    );
  `);

  // Create orders table
  await connection.query(`
    CREATE TABLE orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      table_number INT NOT NULL,
      total_amount DECIMAL(10, 2) NOT NULL,
      status VARCHAR(50) DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // SET STARTING ORDER ID TO 20
  await connection.query(`ALTER TABLE orders AUTO_INCREMENT = 20;`);

  // Populate menu items
  await connection.query(`
    INSERT INTO menu (name, price, category, image_url) VALUES
    ('Cheeseburger', 120.00, 'Burgers', 'https://via.placeholder.com/150'),
    ('French Fries', 60.00, 'Sides', 'https://via.placeholder.com/150'),
    ('Iced Tea', 45.00, 'Drinks', 'https://via.placeholder.com/150');
  `);

  console.log("SUCCESS: Both menu and orders tables recreated! Starting Order ID set to 20.");
  await connection.end();
}

fixAllTables().catch(console.error);