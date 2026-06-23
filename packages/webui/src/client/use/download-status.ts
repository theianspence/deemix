import { fetchData } from "@/utils/api-utils";
import { ref } from "vue";

export type DownloadState = "downloaded" | "partial" | "missing" | "none";

// Module-level maps shared across all component instances so TheDownloadBar
// can update them directly when a download finishes.
const albumStatusMap = ref<Record<string, DownloadState>>({});
const trackStatusMap = ref<Record<string, DownloadState>>({});

/**
 * Set by TheDownloadBar when a full album download completes. TracklistView
 * watches this to refresh its per-track indicators without a DB round-trip.
 */
export const lastCompletedAlbumId = ref<string | null>(null);

function mapForEndpoint(endpoint: string) {
	return endpoint === "albumStatus" ? albumStatusMap : trackStatusMap;
}

/** Called by TheDownloadBar when a queue item finishes. */
export function markStatusDownloaded(id: string, endpoint: "albumStatus" | "downloadStatus") {
	mapForEndpoint(endpoint).value[id] = "downloaded";
}

/**
 * Resolve the library state of Deezer ids against the global history DB.
 * Returns a reactive map plus a loader; call `loadStatuses(ids)` whenever a new
 * list is rendered. Defaults to per-track status (`downloadStatus`); pass
 * `"albumStatus"` for album-level badges (search results, artist pages).
 */
export function useDownloadStatus(endpoint = "downloadStatus") {
	const statusMap = mapForEndpoint(endpoint);

	async function loadStatuses(ids: (string | number | null | undefined)[]) {
		const unique = [
			...new Set(ids.filter((id) => id != null).map((id) => String(id))),
		];
		if (!unique.length) return;

		try {
			const result = await fetchData(endpoint, {
				ids: unique.join(","),
			});
			statusMap.value = { ...statusMap.value, ...result };
		} catch (e) {
			console.error("Failed to load download statuses", e);
		}
	}

	function getStatus(id: string | number | null | undefined): DownloadState {
		if (id == null) return "none";
		return statusMap.value[String(id)] ?? "none";
	}

	return { statusMap, loadStatuses, getStatus };
}
