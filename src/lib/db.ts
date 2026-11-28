import sql, { type config as SqlConfig } from "mssql";

const globalForSql = globalThis as typeof globalThis & {
  sqlPool?: sql.ConnectionPool;
  sqlPoolPromise?: Promise<sql.ConnectionPool>;
};

function getSqlConfig(): SqlConfig {
  const server = process.env.DB_SERVER;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;

  if (!server || !user || !password || !database) {
    throw new Error("SQL Server environment variables are not fully configured.");
  }

  const portValue = process.env.DB_PORT;
  const port = portValue ? Number(portValue) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be a valid TCP port.");
  }

  return {
    server,
    port,
    user,
    password,
    database,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  };
}

export async function getSqlPool(): Promise<sql.ConnectionPool> {
  if (globalForSql.sqlPool?.connected) {
    return globalForSql.sqlPool;
  }

  if (!globalForSql.sqlPoolPromise) {
    const pool = new sql.ConnectionPool(getSqlConfig());
    globalForSql.sqlPoolPromise = pool.connect().then(
      (connectedPool) => {
        globalForSql.sqlPool = connectedPool;
        return connectedPool;
      },
      (error: unknown) => {
        globalForSql.sqlPoolPromise = undefined;
        throw error;
      },
    );
  }

  return globalForSql.sqlPoolPromise;
}

export { sql };
