import { fetchData } from "@/utils/api-utils.js";
import { defineStore } from "pinia";

interface UserState {
	username: string | null;
	name: string | null;
	isAdmin: boolean;
	canDownloadTracks: boolean;
	canDownloadPlaylists: boolean;
	canDownloadDiscography: boolean;
	canViewFavorites: boolean;
	canViewCharts: boolean;
	loaded: boolean;
}

/**
 * The proxy-authenticated identity for the current browser, sourced from
 * `/api/me`. Drives the header user chip and admin-only UI gating.
 */
export const useUserStore = defineStore("user", {
	state: (): UserState => ({
		username: null,
		name: null,
		isAdmin: false,
		canDownloadTracks: false,
		canDownloadPlaylists: false,
		canDownloadDiscography: false,
		canViewFavorites: false,
		canViewCharts: false,
		loaded: false,
	}),
	getters: {
		displayName: (state) => state.name || state.username || "",
	},
	actions: {
		async fetchMe() {
			try {
				const me = await fetchData("me");
				this.username = me.username ?? null;
				this.name = me.name ?? null;
				this.isAdmin = !!me.isAdmin;
				this.canDownloadTracks = !!me.canDownloadTracks;
				this.canDownloadPlaylists = !!me.canDownloadPlaylists;
				this.canDownloadDiscography = !!me.canDownloadDiscography;
				this.canViewFavorites = !!me.canViewFavorites;
				this.canViewCharts = !!me.canViewCharts;
			} catch {
				// Leave defaults (all false); the server enforces permissions anyway.
			} finally {
				this.loaded = true;
			}
		},
		async ensureLoaded() {
			if (!this.loaded) await this.fetchMe();
		},
	},
});
