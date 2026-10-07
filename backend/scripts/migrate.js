// `npm run db:migrate` (also run by `npm start`): installs the schema on an empty database,
// or applies any migrations the database has not seen yet.
import "dotenv/config";
import { connect, migrate } from "../migrator.js";

const conn = await connect();
try {
  await migrate(conn);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
