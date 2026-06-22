import { deleteHistoryEntry, getHistoryEntry } from "@/helpers/historyDb.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/history";

// Delete a single history entry by id. Admins may delete any entry; standard
// users may delete only their own. Never touches the file on disk.
const handler: ApiHandler["handler"] = (req, res) => {
	const id = Number(req.query.id);
	if (!id || Number.isNaN(id)) {
		res.status(400).send({ error: "Missing or invalid id" });
		return;
	}

	const entry = getHistoryEntry(id);
	if (!entry) {
		res.status(404).send({ error: "Not found" });
		return;
	}

	const isOwner = entry.requested_by === req.user?.username;
	if (!req.user?.isAdmin && !isOwner) {
		res.status(403).send({ error: "Forbidden", message: "Not your entry" });
		return;
	}

	deleteHistoryEntry(id);
	res.send({ result: true });
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
