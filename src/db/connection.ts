import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const databasePath = process.env.DATABASE_PATH ?? './redteamingai.db';
const db = new Database(databasePath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

export { db };
