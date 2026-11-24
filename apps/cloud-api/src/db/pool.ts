import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { opcoesSsl } from './ssl.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_POOL_SIZE,
  ssl: opcoesSsl(),
  timezone: 'Z',
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: true,
});

export const fecharPool = () => pool.end();
