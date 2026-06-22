import { getAlbumStatusForIds } from "@/helpers/historyDb.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/albumStatus";

// Given `?ids=1,2,3` of Deezer album ids, returns each album's library state:
// "downloaded" / "partial" / "missing" / "none". Powers the album badges on
// search results and artist pages.
const handler: ApiHandler["handler"] = (req, res) => {
	const idsParam = req.query.ids ? String(req.query.ids) : "";
	const ids = idsParam
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	res.send(getAlbumStatusForIds(ids));
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
