import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	addDownloadRecords,
	closeDb,
	deleteAlbum,
	deleteHistoryEntry,
	getAlbumTracks,
	getDownloadStatusForTrackIds,
	getStats,
	listHistory,
	listLibrary,
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

describe("library grouping", () => {
	beforeAll(() => {
		addDownloadRecords([
			{
				deezerId: "a1",
				parentId: "alb1",
				type: "album",
				title: "Track One",
				artist: "The Artist",
				album: "My Album",
				parentTitle: "My Album",
				path: existingFile,
				status: "success",
				requestedBy: "alice",
			},
			{
				deezerId: "a2",
				parentId: "alb1",
				type: "album",
				title: "Track Two",
				artist: "The Artist",
				album: "My Album",
				parentTitle: "My Album",
				path: join(tmpDir, "gone.flac"),
				status: "success",
				requestedBy: "alice",
			},
		]);
	});

	test("groups tracks into a single album entry", () => {
		const album = listLibrary().find(
			(e) => e.key === "alb1" && e.type === "album"
		);
		expect(album).toBeTruthy();
		expect(album!.title).toBe("My Album");
		expect(album!.artist).toBe("The Artist");
		expect(album!.trackCount).toBe(2);
		expect(album!.presentCount).toBe(1); // one file exists, one missing
		expect(album!.status).toBe("partial");
	});

	test("getAlbumTracks returns the album's tracks with file presence", () => {
		const tracks = getAlbumTracks("alb1", "album");
		expect(tracks.length).toBe(2);
		expect(tracks.some((t) => t.fileExists)).toBe(true);
		expect(tracks.some((t) => !t.fileExists)).toBe(true);
	});

	test("album delete is ownership-scoped", () => {
		const asBob = deleteAlbum("alb1", "album", {
			username: "bob",
			isAdmin: false,
		});
		expect(asBob.existed).toBe(true);
		expect(asBob.deleted).toBe(0); // bob owns none

		const asAlice = deleteAlbum("alb1", "album", {
			username: "alice",
			isAdmin: false,
		});
		expect(asAlice.deleted).toBe(2);
		expect(listLibrary().find((e) => e.key === "alb1")).toBeUndefined();
	});
});
