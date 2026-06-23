import { listHistory } from "@/helpers/historyDb.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/history";

// Global download log, visible to every authenticated user. Supports search,
// sort, and paging; each success row is annotated with `fileExists` so the UI
// can flag entries whose file has since been removed from disk.
const handler: ApiHandler["handler"] = (req, res) => {
	const { search, sort, order, limit, offset } = req.query;
	const result = listHistory({
		search: search ? String(search) : undefined,
		sort: sort ? String(sort) : undefined,
		order: order === "asc" ? "asc" : "desc",
		limit: limit ? Number(limit) : undefined,
		offset: offset ? Number(offset) : undefined,
	});
	res.send(result);
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
