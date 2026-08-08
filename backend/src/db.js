import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const {
  MYSQL_HOST = "localhost",
  MYSQL_PORT = "3306",
  MYSQL_USER = "root",
  MYSQL_PASSWORD = "",
  MYSQL_DATABASE = "chupian",
  MYSQL_CONNECTION_LIMIT = "12",
} = process.env;

export const mysqlPool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  connectionLimit: Number(MYSQL_CONNECTION_LIMIT),
  namedPlaceholders: false,
  dateStrings: true,
  charset: "utf8mb4",
  waitForConnections: true,
  queueLimit: 0,
});

export const query = async (sql, params = []) => {
  const [rows] = await mysqlPool.query(sql, params);
  return rows;
};

export async function closeDb() {
  await mysqlPool.end();
}

export const tx = async (fn) => {
  const conn = await mysqlPool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};
