import { type ApiHandler } from "@/types.js";

const path: ApiHandler["path"] = "/me";

// Returns the proxy-authenticated identity for the current request so the UI
// can show the username and toggle admin-only features.
const handler: ApiHandler["handler"] = (req, res) => {
	res.send({
		username: req.user?.username ?? null,
		name: req.user?.name ?? null,
		isAdmin: req.user?.isAdmin ?? false,
		canDownloadTracks: req.user?.canDownloadTracks ?? false,
		canDownloadPlaylists: req.user?.canDownloadPlaylists ?? false,
		canDownloadDiscography: req.user?.canDownloadDiscography ?? false,
		canViewFavorites: req.user?.canViewFavorites ?? true,
		canViewCharts: req.user?.canViewCharts ?? true,
	});
};

const apiHandler: ApiHandler = { path, handler };

export default apiHandler;
