import { getMigrations } from "better-auth/db/migration";
import { auth } from "../auth.js";

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);

if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("Better Auth schema is up to date.");
} else {
  await runMigrations();
  console.log(
    "Better Auth schema migrated.",
    [...toBeCreated, ...toBeAdded].map(({ table }) => table).join(", "),
  );
}

process.exit(0);