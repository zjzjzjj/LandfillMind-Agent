import initSqlJs, { type Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径（sql.js：SQLite 以 WASM 形式运行，无需原生编译）
// DB_PATH 支持相对路径（相对进程 cwd）与绝对路径；Render 等容器环境用 /app/data/chat.db
const defaultDbPath = path.join(__dirname, '..', 'data', 'chat.db');
const dbPath = process.env.DB_PATH
  ? (path.isAbsolute(process.env.DB_PATH) ? process.env.DB_PATH : path.resolve(process.cwd(), process.env.DB_PATH))
  : defaultDbPath;
const dataDir = path.dirname(dbPath);
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch {
  // 目录不可创建（只读容器等）：后续写入会自动降级为纯内存模式
}

// 模块级数据库实例（在 initDb() 完成后就绪）
let db: Database | null = null;
// 文件锁 fd：Render 滚动重启瞬间可能双实例并存，没有 flock 会把 db 写坏
let dbFd: number | null = null;
// 本进程被另一实例的锁文件挡住时降级为内存库（true = 跳过所有写盘）
let lockedByOther = false;

// sql.js 需要异步加载 WASM，因此在服务器启动前调用一次
export async function initDb(): Promise<void> {
  const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: (file: string) => (file === 'sql-wasm.wasm' ? wasmPath : file),
  });
  let loaded = false;

  // ① PID 锁文件（跨平台）：防止 Render 滚动重启时双实例并发写把 SQLite 文件写坏
  //    若锁文件里的 PID 仍存活，本进程降级为纯内存库（不读旧文件、不写新文件）
  lockedByOther = false;
  try {
    const lockPath = dbPath + '.lock';
    if (fs.existsSync(lockPath)) {
      const oldPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
      if (oldPid && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0); // signal 0 = 探测进程是否存在
          lockedByOther = true;
          console.warn(`[db] 锁文件持有者 PID=${oldPid} 仍存活，本实例降级为内存库（Render 重启旧实例后可恢复）`);
        } catch (e: any) {
          if (e?.code === 'ESRCH') { /* 旧 PID 已退出，锁残留可接受 */ }
          else { lockedByOther = true; }
        }
      }
    }
    if (!lockedByOther) {
      fs.writeFileSync(lockPath, String(process.pid));
      // 进程退出时清理锁文件（P0 修复：不再在此注册 SIGINT/SIGTERM 处理器——
      // 原实现 process.exit(0) 会先于 index.ts 的 gracefulShutdown（异步 server.close →
      // persistNow()）执行，导致 Render 滚动重启每次都丢最近约 1 秒的写入。
      // 信号由 index.ts gracefulShutdown 统一处理：先落盘、再 cleanupDbLock、再退出。）
      const cleanup = () => { try { fs.unlinkSync(lockPath); } catch {} };
      process.once('exit', cleanup);
    }
  } catch {
    // 锁文件读写失败：保守降级为内存库
    lockedByOther = true;
  }

  // ② 若没被锁，正常读取文件
  if (!lockedByOther && fs.existsSync(dbPath)) {
    try {
      dbFd = fs.openSync(dbPath, 'r+');
      const fileBuffer = fs.readFileSync(dbFd);
      // 读完立即释放句柄（Windows 不允许 rename 覆盖仍被打开的文件 ——
      // 此前 persistWrite 的 .tmp → rename 一直 EPERM 失败，落盘形同虚设）
      try { fs.closeSync(dbFd); } catch { /* ignore */ }
      dbFd = null;
      db = new SQL.Database(fileBuffer);
      loaded = true;
    } catch {
      // 文件损坏：新建内存库
    }
  }
  if (!loaded) {
    db = new SQL.Database();
  }
  createTables();
  schedulePersist();
}

// 将内存中的数据库持久化到文件
// Debounced 落盘：标记 dirty + 1 秒批量合并写，避免大库同步阻塞主线程
let persistScheduled = false;
let persistTimer: NodeJS.Timeout | null = null;
function schedulePersist(): void {
  if (!db || persistScheduled) return;
  persistScheduled = true;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistScheduled = false;
    persistTimer = null;
    persistWrite();
  }, 1000);
  persistTimer.unref?.();
}

/** 原子写盘：先写 .tmp，再 rename，避免半写文件被另进程读到 */
function persistWrite(): void {
  if (!db) return;
  if (lockedByOther) return; // 本实例被锁降级为内存库，跳过所有写盘
  try {
    const data = Buffer.from(db.export());
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dbPath);
  } catch (e) {
    // 写盘失败：保留内存数据库；下次再试
    console.error('[db] persistWrite 失败:', (e as Error)?.message);
  }
}

/** 进程退出时立即落盘（不等 debounce） */
export function persistNow(): void {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; persistScheduled = false; }
  persistWrite();
}

/** 清理 PID 锁文件（由 index.ts gracefulShutdown 在 persistNow 之后调用，再退出进程） */
export function cleanupDbLock(): void {
  try {
    const lockPath = dbPath + '.lock';
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch { /* 清理失败不影响退出 */ }
}

// 初始化数据库表
function createTables(): void {
  if (!db) return;
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      sdk_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL,
      tool_calls TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

    -- v5：工具运行记录（可追溯：参数出处 / 结果 / 耗时），供工程报告与"结果怎么算出来的"追溯
    CREATE TABLE IF NOT EXISTS tool_runs (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      tool_label TEXT,
      params_json TEXT,
      result_summary TEXT,
      grade TEXT,
      status TEXT,
      elapsed_ms REAL,
      session_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_runs_session ON tool_runs(session_id, created_at);
  `);

  // 迁移：添加 sdk_session_id 列（若不存在）
  try {
    const info = db.exec('PRAGMA table_info(sessions)')[0];
    const hasColumn = (info?.values ?? []).some((row: any[]) => row[1] === 'sdk_session_id');
    if (!hasColumn) {
      db.run('ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT');
      console.log('[DB] Added sdk_session_id column to sessions table');
    }
  } catch (e) {
    // 列可能已存在，忽略
  }
}

// 类型定义
export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

function getDb(): Database {
  if (!db) throw new Error('数据库尚未初始化，请先调用 initDb()');
  return db;
}

// sql.js 的 Statement 没有 .all()/.get()，这里用 step()+getAsObject() 模拟
function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = getDb().prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  return queryAll<T>(sql, params)[0];
}

// ============= 会话操作 =============

export function getAllSessions(): DbSession[] {
  return queryAll<DbSession>('SELECT * FROM sessions ORDER BY updated_at DESC');
}

export function getSession(id: string): DbSession | undefined {
  return queryOne<DbSession>('SELECT * FROM sessions WHERE id = ?', [id]);
}

export function createSession(session: DbSession): DbSession {
  const stmt = getDb().prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    session.id,
    session.title,
    session.model,
    session.sdk_session_id,
    session.created_at,
    session.updated_at,
  ]);
  schedulePersist();
  return session;
}

/** 新增或整体更新会话（前端每次消息后同步，刷新不丢） */
export function upsertSession(session: DbSession): DbSession {
  const stmt = getDb().prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      model = excluded.model,
      sdk_session_id = excluded.sdk_session_id,
      updated_at = excluded.updated_at
  `);
  stmt.run([
    session.id,
    session.title,
    session.model,
    session.sdk_session_id,
    session.created_at,
    session.updated_at,
  ]);
  schedulePersist();
  return session;
}

/** 整体替换某会话的消息列表（事务保护，差量 upsert）
 *  优化点：仅 DELETE 旧的、INSERT 新的；新旧 id 相同的不动（避免无谓 IO）。
 *  配合前端 useChat skipPersist + finally flushSessionMessages，从 60+ 次写/回答 降到 1 次写/回答。
 */
export function replaceMessages(sessionId: string, messages: DbMessage[]): void {
  const database = getDb();
  database.run('BEGIN TRANSACTION');
  try {
    // 取现存的 id 集合
    const existing = database.exec('SELECT id FROM messages WHERE session_id = ?', [sessionId]);
    const existingIds = new Set<string>(
      (existing[0]?.values ?? []).map((r: any[]) => String(r[0]))
    );
    const newIds = new Set<string>(messages.map(m => String(m.id)));

    // 1) 删除旧的
    if (existingIds.size > 0) {
      const toDelete = [...existingIds].filter(id => !newIds.has(id));
      if (toDelete.length > 0) {
        const placeholders = toDelete.map(() => '?').join(',');
        database.run(`DELETE FROM messages WHERE session_id = ? AND id IN (${placeholders})`, [sessionId, ...toDelete]);
      }
    } else {
      database.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
    }

    // 2) upsert（INSERT ... ON CONFLICT(id) DO UPDATE）
    const stmt = database.prepare(`
      INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        role = excluded.role,
        content = excluded.content,
        model = excluded.model,
        tool_calls = excluded.tool_calls
    `);
    for (const msg of messages) {
      stmt.run([
        msg.id,
        msg.session_id,
        msg.role,
        msg.content,
        msg.model,
        msg.created_at,
        msg.tool_calls,
      ]);
    }
    stmt.free();

    database.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [new Date().toISOString(), sessionId]);
    database.run('COMMIT');
  } catch (e) {
    database.run('ROLLBACK');
    throw e;
  }
  schedulePersist();
}

export function updateSession(
  id: string,
  updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = getDb().prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(values);
  schedulePersist();
  return (result as any).changes > 0;
}

export function deleteSession(id: string): boolean {
  const database = getDb();
  database.run('DELETE FROM messages WHERE session_id = ?', [id]);
  const stmt = database.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run([id]);
  schedulePersist();
  return (result as any).changes > 0;
}

// ============= 消息操作 =============

export function getMessagesBySession(sessionId: string): DbMessage[] {
  return queryAll<DbMessage>('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC', [sessionId]);
}

export function createMessage(message: DbMessage): DbMessage {
  const stmt = getDb().prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls,
  ]);

  const updateStmt = getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run([new Date().toISOString(), message.session_id]);

  schedulePersist();
  return message;
}

export function updateMessage(
  id: string,
  updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }

  if (fields.length === 0) return false;

  values.push(id);

  const stmt = getDb().prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(values);
  schedulePersist();
  return (result as any).changes > 0;
}

export function deleteMessage(id: string): boolean {
  const stmt = getDb().prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run([id]);
  schedulePersist();
  return (result as any).changes > 0;
}

export function createMessages(messages: DbMessage[]): void {
  const database = getDb();
  database.run('BEGIN TRANSACTION');
  try {
    const stmt = database.prepare(`
      INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const msg of messages) {
      stmt.run([
        msg.id,
        msg.session_id,
        msg.role,
        msg.content,
        msg.model,
        msg.created_at,
        msg.tool_calls,
      ]);
    }
    database.run('COMMIT');
  } catch (e) {
    database.run('ROLLBACK');
    throw e;
  }
  schedulePersist();
}

export function clearAllData(): void {
  const database = getDb();
  database.run('DELETE FROM messages');
  database.run('DELETE FROM sessions');
  database.run('DELETE FROM tool_runs');
  schedulePersist();
}

// ============= Tool 运行记录（v5 · 可追溯） =============

export interface ToolRunRecord {
  id: string;
  tool: string;
  /** 对应 DB 列 tool_label（queryAll getAsObject 返回原始列名） */
  tool_label: string | null;
  params_json: string;
  result_summary: string;
  grade: string | null;
  status: string;
  elapsed_ms: number;
  session_id: string | null;
  created_at: string;
}

/** 保存一次工具运行（参数出处 / 结果摘要 / 耗时） */
export function saveToolRun(
  run: {
    runId: string; tool: string; toolLabel: string; params: unknown; result: unknown;
    unit?: string; grade?: string; status: string; warnings: string[]; elapsedMs: number; startedAt: number;
  },
  sessionId?: string,
): void {
  const database = getDb();
  const rawResult = run.result as Record<string, unknown> | null | undefined;
  const summary = rawResult && typeof rawResult === 'object'
    ? String(rawResult.summary ?? rawResult.analysis ?? rawResult.desc ?? '')
    : '';
  database.run(
    `INSERT OR REPLACE INTO tool_runs (id, tool, tool_label, params_json, result_summary, grade, status, elapsed_ms, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.runId,
      run.tool,
      run.toolLabel,
      JSON.stringify(run.params ?? {}).slice(0, 8000),
      JSON.stringify({ summary, warnings: run.warnings ?? [] }).slice(0, 4000),
      run.grade ?? null,
      run.status,
      run.elapsedMs,
      sessionId ?? null,
      new Date(run.startedAt || Date.now()).toISOString(),
    ],
  );
  schedulePersist();
}

export function getToolRun(id: string): ToolRunRecord | null {
  return queryOne<ToolRunRecord>('SELECT * FROM tool_runs WHERE id = ?', [id]) ?? null;
}

export function getToolRunsBySession(sessionId: string, limit = 50): ToolRunRecord[] {
  return queryAll<ToolRunRecord>(
    'SELECT * FROM tool_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
    [sessionId, limit],
  );
}

export function getRecentToolRuns(limit = 50): ToolRunRecord[] {
  return queryAll<ToolRunRecord>('SELECT * FROM tool_runs ORDER BY created_at DESC LIMIT ?', [limit]);
}

export default db;
