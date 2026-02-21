import { db } from './connection.js';
import { SCHEMA_SQL } from './schema.js';

export function runMigrations(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
  const applied = db.prepare('SELECT COUNT(*) as count FROM schema_migrations WHERE version = 1').get() as { count: number };
  if (applied.count === 0) {
    db.exec(SCHEMA_SQL);
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(new Date().toISOString());
  }
}
