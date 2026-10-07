// `npm run db:schema`: fresh install from sql/unified-schema.sql (empty database only).
import "dotenv/config";
import { connect, installFresh } from "../migrator.js";

const conn = await connect();
try {
  await installFresh(conn);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
