import { getDirectorySize } from "@/helpers/diskUsage.js";
import { getStats } from "@/helpers/historyDb.js";
import { requireAdmin } from "@/middleware/auth.js";
import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/admin/stats";

// Admin-only instance overview: total successful downloads, per-user counts,
// and the on-disk size of the download directory.
const handler: ApiHandler["handler"] = (req, res) => {
	const deemix = req.app.get("deemix");
	const downloadDir =
		deemix?.settings?.downloadLocation ||
		process.env.DEEMIX_MUSIC_DIR ||
		"/downloads";

	const stats = getStats();
	const diskUsage = getDirectorySize(downloadDir);

	res.send({ ...stats, diskUsage, downloadDir });
};

const apiHandler: ApiHandler = { path, handler, middleware: [requireAdmin] };

export default apiHandler;
