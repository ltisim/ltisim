const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

// TLS to the database when DB_SSL=true. Uses the system CA store unless
// DB_SSL_CA points at a CA bundle (needed for some managed databases).
const sslConfig =
  process.env.DB_SSL === 'true'
    ? {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA && { ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8') }),
      }
    : undefined;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ...(sslConfig && { ssl: sslConfig }),
});

pool.on('connect', () => {
  console.log('Database connected successfully');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
module.exports.sslConfig = sslConfig;
