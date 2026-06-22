import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	addDownloadRecords,
	closeDb,
	deleteHistoryEntry,
	getDownloadStatusForTrackIds,
	getStats,
	listHistory,
} from "./historyDb.js";

let tmpDir: string;
let existingFile: string;

beforeAll(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "deemix-history-"));
	process.env.DEEMIX_DB_PATH = join(tmpDir, "history.db");
	existingFile = join(tmpDir, "song.flac");
	writeFileSync(existingFile, "audio");

	addDownloadRecords([
		{
			deezerId: "111",
			type: "track",
			title: "Alpha",
			artist: "ArtistX",
			path: existingFile,
			status: "success",
			requestedBy: "alice",
		},
		{
			deezerId: "222",
			type: "album",
			title: "Beta",
			artist: "ArtistY",
			album: "Beta",
			path: join(tmpDir, "missing.flac"),
			status: "success",
			requestedBy: "bob",
		},
		{
			deezerId: "333",
			type: "track",
			title: "Gamma",
			artist: "ArtistZ",
			path: null,
			status: "failed",
			requestedBy: "alice",
		},
	]);
});

afterAll(() => {
	closeDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("historyDb", () => {
	test("inserts and lists all records", () => {
		const { rows, total } = listHistory({ limit: 100 });
		expect(total).toBe(3);
		expect(rows.length).toBe(3);
	});

	test("annotates fileExists per success row", () => {
		const { rows } = listHistory({ limit: 100 });
		const present = rows.find((r) => r.deezer_id === "111");
		const gone = rows.find((r) => r.deezer_id === "222");
		expect(present?.fileExists).toBe(true);
		expect(gone?.fileExists).toBe(false);
	});

	test("resolves downloaded / missing / none states", () => {
		const status = getDownloadStatusForTrackIds(["111", "222", "999"]);
		expect(status["111"]).toBe("downloaded");
		expect(status["222"]).toBe("missing");
		expect(status["999"]).toBe("none");
	});

	test("search filters rows", () => {
		const { rows, total } = listHistory({ search: "Alpha" });
		expect(total).toBe(1);
		expect(rows[0].deezer_id).toBe("111");
	});

	test("stats count only successes, grouped by user", () => {
		const stats = getStats();
		expect(stats.totalDownloads).toBe(2);
		const alice = stats.perUser.find((u) => u.user === "alice");
		expect(alice?.count).toBe(1);
	});

	test("deletes a single entry", () => {
		const { rows } = listHistory({ limit: 100 });
		const target = rows.find((r) => r.deezer_id === "111")!;
		expect(deleteHistoryEntry(target.id)).toBe(true);
		const after = listHistory({ limit: 100 });
		expect(after.rows.find((r) => r.deezer_id === "111")).toBeUndefined();
		expect(after.total).toBe(2);
	});
});
