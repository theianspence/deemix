import { WebSocketServer } from "ws";
import { DeemixApp } from "@/deemixApp.js";

const eventName = "cancelByDeezerID";

const cb = (
	data: { id: string; type: string },
	_ws: any,
	_wss: WebSocketServer,
	deemix: DeemixApp
) => {
	if (!data?.id || !data?.type) return;
	const uuids = Object.values(deemix.queue)
		.filter((item: any) => {
			// Direct match (album/playlist download)
			if (String(item.id) === String(data.id) && item.type === data.type) return true;
			// Individual track downloads stored under an album in the library.
			// albumId is stamped onto queue entries for track downloads in addToQueue.
			if (data.type === "album" && item.type === "track" && item.albumId &&
				String(item.albumId) === String(data.id)) return true;
			return false;
		})
		.map((item: any) => item.uuid);
	uuids.forEach((uuid) => deemix.cancelDownload(uuid));
};

export default { eventName, cb };
