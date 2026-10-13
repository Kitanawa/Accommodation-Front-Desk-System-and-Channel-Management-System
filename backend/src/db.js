import mysql from 'mysql2/promise';
import 'dotenv/config';

// dateStrings: DATE/DATETIME come back as plain strings ('2026-11-25'), avoiding timezone bugs.
export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'frontdesk_ai',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 5,
});
