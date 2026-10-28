import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./client";

async function main() {
  const db = getDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  await closeDb();
  console.log("migrations applied");
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
