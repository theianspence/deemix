import { fetchData } from "@/utils/api-utils";
import { ref } from "vue";

export type DownloadState = "downloaded" | "missing" | "none";

/**
 * Resolve the library state of Deezer track ids against the global history DB.
 * Returns a reactive map plus a loader; call `loadStatuses(ids)` whenever a new
 * list of tracks is rendered (search results, album/playlist tracklists).
 */
export function useDownloadStatus() {
	const statusMap = ref<Record<string, DownloadState>>({});

	async function loadStatuses(ids: (string | number | null | undefined)[]) {
		const unique = [
			...new Set(ids.filter((id) => id != null).map((id) => String(id))),
		];
		if (!unique.length) return;

		try {
			const result = await fetchData("downloadStatus", {
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
