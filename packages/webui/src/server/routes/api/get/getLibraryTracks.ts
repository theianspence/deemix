import { getAlbumTracks } from "@/helpers/historyDb.js";
import { sessionDZ } from "@/deemixApp.js";
import { type ApiHandler } from "@/types.js";

export interface LibraryTrack {
	deezerId: string;
	title: string;
	artist: string;
	trackNumber: number;
	duration: number;
	explicit: boolean;
	/** "downloaded" = in DB and file present, "missing" = in DB but file gone, "none" = never downloaded */
	status: "downloaded" | "missing" | "none";
	fileExists: boolean;
	deezerLink: string;
	dbId: number | null;
	path: string | null;
}

const path: ApiHandler["path"] = "/library/tracks";

const handler: ApiHandler["handler"] = async (req, res) => {
	const key = req.query.key ? String(req.query.key) : "";
	const type = req.query.type ? String(req.query.type) : "";
	if (!key || !type) {
		res.status(400).send({ error: "Missing key or type" });
		return;
	}

	// DB records for this album/playlist — only contains what has been downloaded.
	const dbRows = getAlbumTracks(key, type);
	const dbByDeezerID = new Map(dbRows.map((r) => [r.deezer_id, r]));

	// For albums, also fetch the full tracklist from Deezer so we can show
	// undownloaded tracks and offer per-track download buttons.
	if (type === "album") {
		try {
			const dz = sessionDZ[""];

			if (dz.loggedIn) {
				const albumData = await dz.api.get_album(key);
				const deezerTracks: LibraryTrack[] = (albumData.tracks?.data ?? []).map(
					(t: any) => {
						const dbRow = dbByDeezerID.get(String(t.id));
						return {
							deezerId: String(t.id),
							title: t.title ?? "",
							artist: t.artist?.name ?? "",
							trackNumber: t.track_position ?? 0,
							duration: t.duration ?? 0,
							explicit: !!t.explicit_lyrics,
							status: dbRow
								? dbRow.fileExists
									? "downloaded"
									: "missing"
								: "none",
							fileExists: dbRow?.fileExists ?? false,
							deezerLink: `https://www.deezer.com/track/${t.id}`,
							dbId: dbRow?.id ?? null,
							path: dbRow?.path ?? null,
						} satisfies LibraryTrack;
					}
				);
				res.send({ tracks: deezerTracks, source: "deezer" });
				return;
			}
		} catch {
			// Fall through to DB-only response
		}
	}

	// Fallback: DB records only (non-album types or Deezer unavailable).
	const fallback: LibraryTrack[] = dbRows.map((r) => ({
		deezerId: r.deezer_id,
		title: r.title ?? "",
		artist: r.artist ?? "",
		trackNumber: 0,
		duration: 0,
		explicit: false,
		status: r.fileExists ? "downloaded" : r.status === "success" ? "missing" : "none",
		fileExists: r.fileExists,
		deezerLink: `https://www.deezer.com/track/${r.deezer_id}`,
		dbId: r.id,
		path: r.path,
	}));
	res.send({ tracks: fallback, source: "db" });
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
