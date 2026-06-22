import { deleteAlbum } from "@/helpers/historyDb.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/library";

// Delete a whole album/playlist group. Admins may delete any; standard users
// only their own. Never removes the files on disk.
const handler: ApiHandler["handler"] = (req, res) => {
	const key = req.query.key ? String(req.query.key) : "";
	const type = req.query.type ? String(req.query.type) : "";
	if (!key || !type) {
		res.status(400).send({ error: "Missing key or type" });
		return;
	}

	const result = deleteAlbum(key, type, {
		username: req.user?.username ?? "",
		isAdmin: !!req.user?.isAdmin,
	});

	if (!result.existed) {
		res.status(404).send({ error: "Not found" });
		return;
	}
	if (result.deleted === 0) {
		res.status(403).send({ error: "Forbidden", message: "Not your album" });
		return;
	}

	res.send({ result: true, deleted: result.deleted });
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
