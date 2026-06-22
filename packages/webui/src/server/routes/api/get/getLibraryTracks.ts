import { getAlbumTracks } from "@/helpers/historyDb.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/library/tracks";

// The per-track breakdown for one album/playlist group (the detail view), each
// track annotated with whether its file is still on disk.
const handler: ApiHandler["handler"] = (req, res) => {
	const key = req.query.key ? String(req.query.key) : "";
	const type = req.query.type ? String(req.query.type) : "";
	if (!key || !type) {
		res.status(400).send({ error: "Missing key or type" });
		return;
	}
	res.send({ tracks: getAlbumTracks(key, type) });
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
