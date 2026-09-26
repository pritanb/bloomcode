import Database from 'better-sqlite3';

export type Tables = Record<string, Record<string, unknown>[]>;
/**
 * Every table's rows, for "nothing changed" checks and for looking at what was saved.
 * Pass a database file (read through a separate connection) or an open connection.
 */
export function readTables(source: string | Database.Database): Tables {
  const db =
    typeof source === 'string'
      ? new Database(source, { readonly: true, fileMustExist: true })
      : source;
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .pluck()
      .all() as string[];
    return Object.fromEntries(
      names.map((name) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]),
    ) as Tables;
  } finally {
    if (typeof source === 'string') db.close();
  }
}
