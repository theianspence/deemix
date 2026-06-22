import { fetchData } from "@/utils/api-utils.js";
import { defineStore } from "pinia";

interface UserState {
	username: string | null;
	name: string | null;
	isAdmin: boolean;
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
			} catch {
				// Leave defaults; the app stays usable read-only.
			} finally {
				this.loaded = true;
			}
		},
		async ensureLoaded() {
			if (!this.loaded) await this.fetchMe();
		},
	},
});
