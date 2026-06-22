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
	/** Name of the album/playlist/collection the request was for. */
	parentTitle?: string | null;
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
	parent_title: string | null;
	path: string | null;
	status: string;
	requested_by: string;
	bitrate: number | null;
	uuid: string | null;
	created_at: number;
}

export type DownloadState = "downloaded" | "partial" | "missing" | "none";

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
	// Deliberately NOT WAL: the DB usually lives on a bind-mounted volume
	// (/config), and WAL's shared-memory (-shm) coordination is unreliable over
	// Docker Desktop's Windows/macOS bind mounts — a fresh connection can read
	// zero rows even though the -wal holds data. The rollback journal (DELETE)
	// writes committed rows straight into the main file and survives restarts on
	// every filesystem. Write volume here is tiny (a batch per finished download).
	db.pragma("journal_mode = DELETE");
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
		CREATE INDEX IF NOT EXISTS idx_downloads_parent ON downloads(parent_id, type);
	`);

	// Migration: parent_title (the album/playlist/collection name) lets the
	// Library view label groups even for playlists and single tracks. Older DBs
	// fall back to the per-track `album` column.
	const hasParentTitle = (
		db.prepare("PRAGMA table_info(downloads)").all() as { name: string }[]
	).some((c) => c.name === "parent_title");
	if (!hasParentTitle) {
		db.exec("ALTER TABLE downloads ADD COLUMN parent_title TEXT");
	}

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
			(deezer_id, parent_id, type, title, artist, album, parent_title, path, status, requested_by, bitrate, uuid, created_at)
		 VALUES
			(@deezer_id, @parent_id, @type, @title, @artist, @album, @parent_title, @path, @status, @requested_by, @bitrate, @uuid, @created_at)`
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
				parent_title: r.parentTitle ?? null,
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

/**
 * Resolve the library state for a set of Deezer **album** ids (for the badge on
 * album search results and artist pages). An album is "downloaded" when every
 * recorded file still exists, "partial" when some are gone, "missing" when all
 * are gone, "none" when it was never downloaded.
 */
export function getAlbumStatusForIds(
	ids: (string | number)[]
): Record<string, DownloadState> {
	const result: Record<string, DownloadState> = {};
	const stringIds = ids.map((id) => String(id));
	for (const id of stringIds) result[id] = "none";

	if (!stringIds.length) return result;

	const database = getDb();
	const CHUNK = 500;
	const pathsById = new Map<string, string[]>();

	for (let i = 0; i < stringIds.length; i += CHUNK) {
		const chunk = stringIds.slice(i, i + CHUNK);
		const placeholders = chunk.map(() => "?").join(",");
		const rows = database
			.prepare(
				`SELECT parent_id, path FROM downloads
				 WHERE status = 'success' AND type = 'album' AND parent_id IN (${placeholders})`
			)
			.all(...chunk) as { parent_id: string; path: string | null }[];

		for (const row of rows) {
			const list = pathsById.get(row.parent_id) ?? [];
			if (row.path) list.push(row.path);
			pathsById.set(row.parent_id, list);
		}
	}

	for (const [id, paths] of pathsById) {
		if (!paths.length) {
			result[id] = "missing";
			continue;
		}
		const present = paths.filter((p) => fs.existsSync(p)).length;
		result[id] =
			present === 0
				? "missing"
				: present === paths.length
					? "downloaded"
					: "partial";
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

/** One album/playlist/single in the album-centric Library view. */
export interface LibraryEntry {
	key: string; // parent_id (Deezer album/playlist/track id), the cover-art key
	type: string; // album | playlist | track
	title: string;
	artist: string;
	trackCount: number; // successfully downloaded tracks
	presentCount: number; // of those, how many files still exist on disk
	failedCount: number;
	requestedBy: string; // most recent requester
	owners: string[]; // every distinct requester (for delete gating)
	createdAt: number; // most recent download time
	status: "downloaded" | "partial" | "missing" | "failed";
}

/**
 * Group the per-track rows into albums/playlists/singles for the Library view.
 * Grouping key is (type, parent_id) — i.e. the Deezer album/playlist the request
 * was for. Loads rows into memory and checks file presence per track; fine for a
 * personal library, where row counts stay modest.
 */
export function listLibrary(search?: string): LibraryEntry[] {
	const database = getDb();
	const rows = database
		.prepare(
			`SELECT parent_id, type, title, album, parent_title, artist, path, status, requested_by, created_at
			 FROM downloads`
		)
		.all() as HistoryRow[];

	const groups = new Map<string, HistoryRow[]>();
	for (const row of rows) {
		const key = `${row.type}::${row.parent_id ?? ""}`;
		const list = groups.get(key) ?? [];
		list.push(row);
		groups.set(key, list);
	}

	const entries: LibraryEntry[] = [];
	for (const list of groups.values()) {
		const first = list[0];
		const successRows = list.filter((r) => r.status === "success");
		const failedRows = list.filter((r) => r.status === "failed");
		const presentCount = successRows.filter(
			(r) => r.path && fs.existsSync(r.path)
		).length;

		const title = first.parent_title || first.album || first.title || "Unknown";

		// Most common artist in the group (albums by one artist => that artist).
		const artistCounts = new Map<string, number>();
		for (const r of list) {
			if (r.artist)
				artistCounts.set(r.artist, (artistCounts.get(r.artist) ?? 0) + 1);
		}
		const artist =
			[...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

		const owners = [...new Set(list.map((r) => r.requested_by))];
		const createdAt = Math.max(...list.map((r) => r.created_at));
		const requestedBy =
			[...list].sort((a, b) => b.created_at - a.created_at)[0]?.requested_by ??
			owners[0];

		let status: LibraryEntry["status"];
		if (successRows.length === 0) status = "failed";
		else if (presentCount === successRows.length) status = "downloaded";
		else if (presentCount === 0) status = "missing";
		else status = "partial";

		entries.push({
			key: String(first.parent_id ?? ""),
			type: first.type,
			title,
			artist,
			trackCount: successRows.length,
			presentCount,
			failedCount: failedRows.length,
			requestedBy,
			owners,
			createdAt,
			status,
		});
	}

	let filtered = entries;
	if (search) {
		const q = search.toLowerCase();
		filtered = entries.filter(
			(e) =>
				e.title.toLowerCase().includes(q) ||
				e.artist.toLowerCase().includes(q) ||
				e.requestedBy.toLowerCase().includes(q)
		);
	}

	filtered.sort((a, b) => b.createdAt - a.createdAt);
	return filtered;
}

/** Tracks belonging to one album/playlist group (for the detail view). */
export function getAlbumTracks(
	key: string,
	type: string
): HistoryRowWithFile[] {
	const rows = getDb()
		.prepare(
			"SELECT * FROM downloads WHERE parent_id = ? AND type = ? ORDER BY created_at ASC, id ASC"
		)
		.all(key, type) as HistoryRow[];
	return rows.map((row) => ({
		...row,
		fileExists:
			row.status === "success" && !!row.path ? fs.existsSync(row.path) : false,
	}));
}

/**
 * Delete a whole album/playlist group. Admins remove every row; standard users
 * remove only the rows they requested. Returns whether the group existed and how
 * many rows were removed so the handler can map to 404 / 403 / 200.
 */
export function deleteAlbum(
	key: string,
	type: string,
	opts: { username: string; isAdmin: boolean }
): { existed: boolean; deleted: number } {
	const database = getDb();
	const existed =
		(
			database
				.prepare(
					"SELECT COUNT(*) AS c FROM downloads WHERE parent_id = ? AND type = ?"
				)
				.get(key, type) as { c: number }
		).c > 0;

	const info = opts.isAdmin
		? database
				.prepare("DELETE FROM downloads WHERE parent_id = ? AND type = ?")
				.run(key, type)
		: database
				.prepare(
					"DELETE FROM downloads WHERE parent_id = ? AND type = ? AND requested_by = ?"
				)
				.run(key, type, opts.username);

	return { existed, deleted: info.changes };
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
