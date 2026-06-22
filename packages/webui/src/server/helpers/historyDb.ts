import Database from "better-sqlite3";
import fs from "fs";
import { dirname } from "path";
import { logger } from "./logger.js";

/** A record to persist after a download finishes (one per track). */
export interface DownloadRecord {
	deezerId: string | number;
	parentId?: string | number | null;
	type: "track" | "album" | "playlist" | string;
	title?: string | null;
	artist?: string | null;
	album?: string | null;
	path?: string | null;
	status: "success" | "failed";
	requestedBy: string;
	bitrate?: number | null;
	uuid?: string | null;
}

/** A row as stored in / read from the database. */
export interface HistoryRow {
	id: number;
	deezer_id: string;
	parent_id: string | null;
	type: string;
	title: string | null;
	artist: string | null;
	album: string | null;
	path: string | null;
	status: string;
	requested_by: string;
	bitrate: number | null;
	uuid: string | null;
	created_at: number;
}

export type DownloadState = "downloaded" | "missing" | "none";

const SORT_COLUMNS = new Set([
	"created_at",
	"title",
	"artist",
	"album",
	"type",
	"status",
	"requested_by",
]);

let db: Database.Database | null = null;

export function getDbPath(): string {
	return process.env.DEEMIX_DB_PATH || "/config/history.db";
}

export function getDb(): Database.Database {
	if (db) return db;

	const dbPath = getDbPath();
	fs.mkdirSync(dirname(dbPath), { recursive: true });

	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.exec(`
		CREATE TABLE IF NOT EXISTS downloads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			deezer_id TEXT NOT NULL,
			parent_id TEXT,
			type TEXT NOT NULL,
			title TEXT,
			artist TEXT,
			album TEXT,
			path TEXT,
			status TEXT NOT NULL,
			requested_by TEXT NOT NULL,
			bitrate INTEGER,
			uuid TEXT,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_downloads_deezer_id ON downloads(deezer_id);
		CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);
	`);

	return db;
}

/** Close the DB handle (used by tests to reset between runs). */
export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

/** Insert a batch of download records in a single transaction. */
export function addDownloadRecords(records: DownloadRecord[]): void {
	if (!records.length) return;

	const database = getDb();
	const insert = database.prepare(
		`INSERT INTO downloads
			(deezer_id, parent_id, type, title, artist, album, path, status, requested_by, bitrate, uuid, created_at)
		 VALUES
			(@deezer_id, @parent_id, @type, @title, @artist, @album, @path, @status, @requested_by, @bitrate, @uuid, @created_at)`
	);

	const now = Date.now();
	const insertMany = database.transaction((rows: DownloadRecord[]) => {
		for (const r of rows) {
			insert.run({
				deezer_id: String(r.deezerId),
				parent_id: r.parentId != null ? String(r.parentId) : null,
				type: r.type,
				title: r.title ?? null,
				artist: r.artist ?? null,
				album: r.album ?? null,
				path: r.path ?? null,
				status: r.status,
				requested_by: r.requestedBy,
				bitrate: r.bitrate ?? null,
				uuid: r.uuid ?? null,
				created_at: now,
			});
		}
	});

	insertMany(records);
}

export function addDownloadRecord(record: DownloadRecord): void {
	addDownloadRecords([record]);
}

export interface ListHistoryParams {
	search?: string;
	sort?: string;
	order?: "asc" | "desc";
	limit?: number;
	offset?: number;
}

export interface HistoryRowWithFile extends HistoryRow {
	/** Only meaningful for success rows: whether the file is still on disk. */
	fileExists: boolean;
}

/** List history rows (newest first by default) with total count for paging. */
export function listHistory(params: ListHistoryParams = {}): {
	rows: HistoryRowWithFile[];
	total: number;
} {
	const database = getDb();

	const sort = SORT_COLUMNS.has(params.sort ?? "")
		? (params.sort as string)
		: "created_at";
	const order = params.order === "asc" ? "ASC" : "DESC";
	const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
	const offset = Math.max(params.offset ?? 0, 0);

	const where: string[] = [];
	const args: Record<string, unknown> = {};
	if (params.search) {
		where.push(
			"(title LIKE @q OR artist LIKE @q OR album LIKE @q OR requested_by LIKE @q)"
		);
		args.q = `%${params.search}%`;
	}
	const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

	const total = (
		database
			.prepare(`SELECT COUNT(*) AS c FROM downloads ${whereSql}`)
			.get(args) as { c: number }
	).c;

	const rows = database
		.prepare(
			`SELECT * FROM downloads ${whereSql} ORDER BY ${sort} ${order} LIMIT @limit OFFSET @offset`
		)
		.all({ ...args, limit, offset }) as HistoryRow[];

	const withFile: HistoryRowWithFile[] = rows.map((row) => ({
		...row,
		fileExists:
			row.status === "success" && !!row.path ? fs.existsSync(row.path) : false,
	}));

	return { rows: withFile, total };
}

export function getHistoryEntry(id: number): HistoryRow | undefined {
	return getDb().prepare("SELECT * FROM downloads WHERE id = ?").get(id) as
		| HistoryRow
		| undefined;
}

export function deleteHistoryEntry(id: number): boolean {
	const info = getDb().prepare("DELETE FROM downloads WHERE id = ?").run(id);
	return info.changes > 0;
}

/**
 * Resolve the "already downloaded" state for a set of Deezer track IDs.
 * A track is "downloaded" only when a success row exists AND its file is still
 * on disk; "missing" when a success row exists but no recorded file remains.
 */
export function getDownloadStatusForTrackIds(
	ids: (string | number)[]
): Record<string, DownloadState> {
	const result: Record<string, DownloadState> = {};
	const stringIds = ids.map((id) => String(id));
	for (const id of stringIds) result[id] = "none";

	if (!stringIds.length) return result;

	const database = getDb();
	// Chunk to stay within SQLite's variable limit.
	const CHUNK = 500;
	const pathsById = new Map<string, string[]>();

	for (let i = 0; i < stringIds.length; i += CHUNK) {
		const chunk = stringIds.slice(i, i + CHUNK);
		const placeholders = chunk.map(() => "?").join(",");
		const rows = database
			.prepare(
				`SELECT deezer_id, path FROM downloads
				 WHERE status = 'success' AND deezer_id IN (${placeholders})`
			)
			.all(...chunk) as { deezer_id: string; path: string | null }[];

		for (const row of rows) {
			const list = pathsById.get(row.deezer_id) ?? [];
			if (row.path) list.push(row.path);
			pathsById.set(row.deezer_id, list);
		}
	}

	for (const [id, paths] of pathsById) {
		const anyExists = paths.some((p) => fs.existsSync(p));
		result[id] = anyExists ? "downloaded" : "missing";
	}

	return result;
}

export interface HistoryStats {
	totalDownloads: number;
	perUser: { user: string; count: number }[];
}

export function getStats(): HistoryStats {
	const database = getDb();
	const totalDownloads = (
		database
			.prepare("SELECT COUNT(*) AS c FROM downloads WHERE status = 'success'")
			.get() as { c: number }
	).c;
	const perUser = database
		.prepare(
			`SELECT requested_by AS user, COUNT(*) AS count
			 FROM downloads WHERE status = 'success'
			 GROUP BY requested_by ORDER BY count DESC`
		)
		.all() as { user: string; count: number }[];

	return { totalDownloads, perUser };
}

// Surface logger usage so a misconfigured DB path is visible early.
export function initHistoryDb(): void {
	try {
		getDb();
		logger.info(`History database ready at ${getDbPath()}`);
	} catch (e) {
		logger.error(`Failed to open history database at ${getDbPath()}`);
		logger.error(e);
	}
}
