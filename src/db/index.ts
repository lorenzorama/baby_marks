import { drizzle as drizzleNodePg, NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __bmDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__bmDb) globalForDb.__bmDb = init();
  return globalForDb.__bmDb;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const target = url.slice("pglite://".length);
    const client = target === "memory" ? new PGlite() : new PGlite(target);
    const db = drizzlePglite(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    return db;
  }
  const { Pool } = await import("pg");
  return drizzleNodePg(new Pool({ connectionString: url }), { schema });
}
