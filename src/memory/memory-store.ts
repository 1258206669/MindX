/**
 * Memory Store — sql.js (WASM SQLite) 持久化记忆
 * 不需要编译原生模块，Windows/Mac/Linux 通用
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { v4 as uuid } from 'uuid';
import { resolve } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import type { MemoryEntry, MemoryAPI } from '../types.js';

const DEFAULT_DIR = resolve(homedir(), '.macli');
const DEFAULT_DB = resolve(DEFAULT_DIR, 'memory.db');

export class MemoryStore implements MemoryAPI {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private ready: Promise<void>;

  constructor(dbPath: string = DEFAULT_DB) {
    this.dbPath = dbPath;
    this.ready = this.init();
  }

  private async init() {
    mkdirSync(resolve(this.dbPath, '..'), { recursive: true });

    const SQL = await initSqlJs();

    if (existsSync(this.dbPath)) {
      const buf = readFileSync(this.dbPath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        persistent INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_session ON memories(session_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_persistent ON memories(persistent)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp)`);
    this.save();
  }

  async ensureReady() {
    await this.ready;
  }

  private save() {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  add(entry: Omit<MemoryEntry, 'id'>): MemoryEntry {
    const id = uuid();
    const full: MemoryEntry = { id, ...entry };
    this.db.run(
      `INSERT INTO memories (id, session_id, role, agent_name, content, timestamp, tags, persistent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, full.sessionId, full.role, full.agentName, full.content, full.timestamp, JSON.stringify(full.tags), full.persistent ? 1 : 0]
    );
    this.save();
    return full;
  }

  getSession(sessionId: string, limit = 50): MemoryEntry[] {
    const stmt = this.db.prepare(
      `SELECT * FROM memories WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`
    );
    stmt.bind([sessionId, limit]);
    const rows: MemoryEntry[] = [];
    while (stmt.step()) {
      rows.push(rowToEntry(stmt.getAsObject()));
    }
    stmt.free();
    return rows.reverse();
  }

  search(query: string, limit = 10): MemoryEntry[] {
    const stmt = this.db.prepare(
      `SELECT * FROM memories WHERE persistent = 1 AND content LIKE ? ORDER BY timestamp DESC LIMIT ?`
    );
    stmt.bind([`%${query}%`, limit]);
    const rows: MemoryEntry[] = [];
    while (stmt.step()) {
      rows.push(rowToEntry(stmt.getAsObject()));
    }
    stmt.free();
    return rows;
  }

  getByTag(tag: string, limit = 20): MemoryEntry[] {
    const stmt = this.db.prepare(
      `SELECT * FROM memories WHERE tags LIKE ? ORDER BY timestamp DESC LIMIT ?`
    );
    stmt.bind([`%"${tag}"%`, limit]);
    const rows: MemoryEntry[] = [];
    while (stmt.step()) {
      rows.push(rowToEntry(stmt.getAsObject()));
    }
    stmt.free();
    return rows;
  }

  markPersistent(id: string) {
    this.db.run(`UPDATE memories SET persistent = 1 WHERE id = ?`, [id]);
    this.save();
  }

  clearSession(sessionId: string) {
    this.db.run(`DELETE FROM memories WHERE session_id = ? AND persistent = 0`, [sessionId]);
    this.save();
  }

  close() {
    this.save();
    this.db.close();
  }
}

function rowToEntry(row: any): MemoryEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    agentName: row.agent_name,
    content: row.content,
    timestamp: row.timestamp,
    tags: JSON.parse(row.tags),
    persistent: row.persistent === 1,
  };
}
