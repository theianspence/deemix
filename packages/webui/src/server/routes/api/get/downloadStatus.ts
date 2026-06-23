import { getDownloadStatusForTrackIds } from "@/helpers/historyDb.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/downloadStatus";

// Given `?ids=1,2,3`, returns each Deezer track id's library state:
// "downloaded" (success row + file present), "missing" (success row, file gone),
// or "none". Powers the badges on search/album/track listings.
const handler: ApiHandler["handler"] = (req, res) => {
	const idsParam = req.query.ids ? String(req.query.ids) : "";
	const ids = idsParam
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	res.send(getDownloadStatusForTrackIds(ids));
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
