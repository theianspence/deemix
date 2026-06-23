import { fetchData } from "@/utils/api-utils";
import { pinia } from "@/stores";
import { useUserStore } from "@/stores/user";
import { defineStore } from "pinia";

export interface LibraryEntry {
	key: string;
	type: string;
	title: string;
	artist: string;
	trackCount: number;
	presentCount: number;
	failedCount: number;
	requestedBy: string;
	owners: string[];
	createdAt: number;
	status: "downloaded" | "partial" | "missing" | "failed";
}

interface LibraryState {
	entries: LibraryEntry[];
	loading: boolean;
}

export const useLibraryStore = defineStore("library", {
	state: (): LibraryState => ({
		entries: [],
		loading: false,
	}),
	actions: {
		async fetch(search?: string) {
			this.loading = true;
			try {
				const result = await fetchData("library", search ? { search } : {});
				this.entries = result.entries ?? [];
			} catch (e) {
				console.error(e);
			} finally {
				this.loading = false;
			}
		},

		/**
		 * Called by TheDownloadBar the moment a download finishes.
		 * We do NOT fetch from the DB here — recordHistory hasn't written yet
		 * (finishDownload fires from inside Downloader.start() before it returns).
		 * Instead we update or optimistically insert from the queue item data.
		 */
		onDownloadFinished(
			deezerID: string,
			type: string,
			albumID: string | undefined,
			downloaded: number,
			failed: number,
			size: number,
			title: string,
			artist: string
		) {
			const key = type === "track" && albumID ? albumID : deezerID;
			const libType = type === "track" ? "album" : type;

			// Individual track downloads: always optimistically "partial" since we
			// don't know the album's total track count from the queue item alone.
			// The DB-based listLibrary will use parent_nb_tracks to refine this.
			const isIndividualTrack = type === "track";
			const status: LibraryEntry["status"] =
				downloaded === 0
					? "failed"
					: isIndividualTrack || (failed > 0 && downloaded < size)
						? "partial"
						: "downloaded";

			const idx = this.entries.findIndex(
				(e) => e.key === key && e.type === libType
			);
			if (idx >= 0) {
				// Entry already in store — update in-place.
				// For individual tracks, accumulate count (each is size=1).
				const prev = this.entries[idx];
				this.entries[idx] = {
					...prev,
					status,
					presentCount: isIndividualTrack ? prev.presentCount + downloaded : downloaded,
					trackCount: isIndividualTrack ? prev.trackCount + 1 : Math.max(prev.trackCount, size),
				};
			} else {
				// Brand-new entry — optimistically insert from queue data so the
				// library card appears immediately without waiting for the DB write.
				const userStore = useUserStore(pinia);
				const username = userStore.username ?? "unknown";
				this.entries.push({
					key,
					type: libType,
					title,
					artist,
					trackCount: size,
					presentCount: downloaded,
					failedCount: failed,
					requestedBy: username,
					owners: [username],
					createdAt: Date.now(),
					status,
				});
			}
		},

		removeEntry(key: string, type: string) {
			this.entries = this.entries.filter(
				(e) => !(e.key === key && e.type === type)
			);
		},
	},
});
