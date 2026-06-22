import { listLibrary } from "@/helpers/historyDb.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/library";

// Album-centric view of the download history: one entry per album/playlist/
// single, with aggregate status and track counts. Visible to all users.
const handler: ApiHandler["handler"] = (req, res) => {
	const search = req.query.search ? String(req.query.search) : undefined;
	res.send({ entries: listLibrary(search) });
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
