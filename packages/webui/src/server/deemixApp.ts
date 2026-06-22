import { CantStream, NotLoggedIn } from "@/helpers/errors.js";
import {
	addDownloadRecords,
	type DownloadRecord,
} from "@/helpers/historyDb.js";
import { logger } from "@/helpers/logger.js";
import { getLoginCredentials } from "@/helpers/loginStorage.js";
import { WEBUI_PACKAGE_VERSION } from "@/helpers/versions.js";
import {
	Collection,
	Convertable,
	DEFAULT_SETTINGS,
	Downloader,
	generateDownloadObject,
	loadSettings,
	saveSettings,
	Single,
	SpotifyPlugin,
	utils,
	type DownloadObject,
	type Listener,
	type Settings,
	type SpotifySettings,
} from "deemix";
import { Deezer, setDeezerCacheDir } from "deezer-sdk";
import fs from "fs";
import got, { type Response as GotResponse } from "got";
import { sep } from "path";
import { v4 as uuidv4 } from "uuid";

// Constants
export const configFolder: string = utils.getConfigFolder();
setDeezerCacheDir(configFolder);
export const defaultSettings: Settings = DEFAULT_SETTINGS;

// In the multi-user / proxy-auth model there is a single shared Deezer account
// (one ARL managed by admins) used for everyone's searches and downloads. We
// expose it through a Proxy with the original `sessionDZ` shape so the ~20
// existing endpoints (`sessionDZ[req.session.id]`) keep working untouched — the
// session id is ignored and every lookup returns the one shared instance.
let sharedDeezer = new Deezer();
export const sessionDZ: Record<string, Deezer> = new Proxy(
	{} as Record<string, Deezer>,
	{
		get: () => sharedDeezer,
		set: (_target, _prop, value) => {
			sharedDeezer = value as Deezer;
			return true;
		},
	}
);

/** Log the shared account in from the stored ARL at server startup. */
export async function initSharedLogin(): Promise<void> {
	const { arl } = getLoginCredentials();
	if (!arl) {
		logger.info(
			"No stored Deezer ARL — an admin must configure one in the Admin panel."
		);
		return;
	}
	try {
		const ok = await sharedDeezer.loginViaArl(arl);
		if (ok) logger.info("Logged in to Deezer with the stored ARL.");
		else logger.warn("Stored Deezer ARL is invalid or expired.");
	} catch (e) {
		logger.error(e);
	}
}

type DeezerAvailable = "yes" | "no" | "no-network";

export class DeemixApp {
	queueOrder: string[];
	queue: Record<string, any>;
	currentJob: boolean | Downloader | null;

	deezerAvailable?: DeezerAvailable;
	latestVersion: string | null;

	plugins: Record<string, SpotifyPlugin>;
	settings: Settings;

	listener: Listener;

	constructor(listener: Listener) {
		this.settings = loadSettings(configFolder);

		this.queueOrder = [];
		this.queue = {};
		this.currentJob = null;

		this.plugins = {
			spotify: new SpotifyPlugin(),
		};
		this.latestVersion = null;
		this.listener = listener;

		this.plugins.spotify.setup();
		this.restoreQueueFromDisk();
	}

	async isDeezerAvailable() {
		if (this.deezerAvailable) return this.deezerAvailable;

		let response: GotResponse<string>;
		try {
			response = await got.get("https://www.deezer.com/", {
				headers: {
					Cookie:
						"dz_lang=en; Domain=deezer.com; Path=/; Secure; hostOnly=false;",
				},
				https: {
					rejectUnauthorized: false,
				},
				retry: {
					limit: 5,
				},
			});
		} catch (e) {
			logger.error(e);
			this.deezerAvailable = "no-network";

			return this.deezerAvailable;
		}
		const title = (
			response.body.match(/<title[^>]*>([^<]+)<\/title>/)![1] || ""
		).trim();

		this.deezerAvailable =
			title !== "Deezer will soon be available in your country." ? "yes" : "no";

		return this.deezerAvailable;
	}

	async getLatestVersion(force = false): Promise<string | null> {
		if (this.latestVersion === null || force) {
			try {
				const responseJson = await got
					.get(
						`https://raw.githubusercontent.com/bambanah/deemix/main/packages/webui/package.json`
					)
					.json();
				this.latestVersion = JSON.parse(JSON.stringify(responseJson)).version;
			} catch (e) {
				logger.error(e);
				this.latestVersion = "NotFound";
				return this.latestVersion;
			}
		}
		return this.latestVersion;
	}

	parseVersion(version: string | null): any {
		if (version === null || version === "continuous" || version === "NotFound")
			return null;
		try {
			const matchResult =
				version.match(/(\d+)\.(\d+)\.(\d+)-r(\d+)\.(.+)/) || [];
			return {
				year: parseInt(matchResult[1]),
				month: parseInt(matchResult[2]),
				day: parseInt(matchResult[3]),
				revision: parseInt(matchResult[4]),
				commit: matchResult[5] || "",
			};
		} catch (e) {
			logger.error(e);
			return null;
		}
	}

	isUpdateAvailable(): boolean {
		return (
			this.latestVersion.localeCompare(WEBUI_PACKAGE_VERSION, undefined, {
				numeric: true,
			}) === 1
		);
	}

	getSettings() {
		return {
			settings: this.settings,
			defaultSettings,
			spotifySettings: this.plugins.spotify.getSettings(),
		};
	}

	saveSettings(newSettings: Settings, newSpotifySettings: SpotifySettings) {
		saveSettings(newSettings, configFolder);
		this.settings = newSettings;
		this.plugins.spotify.saveSettings(newSpotifySettings);
	}

	getQueue() {
		const result: any = {
			queue: this.queue,
			queueOrder: this.queueOrder,
		};

		if (this.currentJob instanceof Downloader) {
			result.current = this.currentJob.downloadObject.getSlimmedDict();
		}

		return result;
	}

	async addToQueue(
		dz: Deezer,
		url: string[],
		bitrate: number,
		retry: boolean = false,
		requestedBy: string = "unknown"
	) {
		if (!dz.loggedIn) throw new NotLoggedIn();
		if (
			!this.settings.feelingLucky &&
			((!dz.currentUser.can_stream_lossless && bitrate === 9) ||
				(!dz.currentUser.can_stream_hq && bitrate === 3))
		)
			throw new CantStream(bitrate);

		let downloadObjs: DownloadObject[] = [];
		const downloadErrors: any[] = [];
		let link = "";
		const requestUUID = uuidv4();

		if (url.length > 1) {
			this.listener.send("startGeneratingItems", {
				uuid: requestUUID,
				total: url.length,
			});
		}

		for (let i = 0; i < url.length; i++) {
			link = url[i];
			logger.info(`Adding ${link} to queue`);
			try {
				const downloadObj = await generateDownloadObject(
					dz,
					link,
					bitrate,
					this.plugins,
					this.listener
				);

				if (Array.isArray(downloadObj)) {
					downloadObjs = downloadObjs.concat(downloadObj);
				} else if (downloadObj) {
					downloadObjs.push(downloadObj);
				}
			} catch (e) {
				downloadErrors.push(e);
			}
		}

		if (downloadErrors.length) {
			downloadErrors.forEach((e) => {
				if (!e.errid) logger.error(e);
				this.listener.send("queueError", {
					link: e.link,
					error: e.message,
					errid: e.errid,
				});
			});
		}

		if (url.length > 1) {
			this.listener.send("finishGeneratingItems", {
				uuid: requestUUID,
				total: downloadObjs.length,
			});
		}

		const slimmedObjects: Record<string, any>[] = [];

		downloadObjs.forEach((downloadObj) => {
			// Albums-only: individual tracks cannot be queued. Users download
			// collections (albums/playlists/artist discographies), not single
			// tracks. This is the server-side backstop for the UI restriction.
			if (downloadObj.type === "track") {
				this.listener.send("queueError", {
					link: downloadObj.title,
					error: "Only albums can be downloaded, not individual tracks.",
					errid: "albumsOnly",
				});
				return;
			}

			// Check if element is already in queue
			if (Object.keys(this.queue).includes(downloadObj.uuid) && !retry) {
				this.listener.send("alreadyInQueue", downloadObj.getEssentialDict());
				return;
			}

			// Save queue status when adding something to the queue
			if (!fs.existsSync(configFolder + "queue"))
				fs.mkdirSync(configFolder + "queue");

			this.queueOrder.push(downloadObj.uuid);
			fs.writeFileSync(
				configFolder + `queue${sep}order.json`,
				JSON.stringify(this.queueOrder)
			);
			this.queue[downloadObj.uuid] = downloadObj.getEssentialDict();
			this.queue[downloadObj.uuid].status = "inQueue";
			// Attribute the download to the requesting user (from the proxy auth
			// header). Persisted with the queue item so it survives a restart and
			// is available when the history record is written on completion.
			this.queue[downloadObj.uuid].requestedBy = requestedBy;

			fs.writeFileSync(
				configFolder + `queue${sep}${downloadObj.uuid}.json`,
				JSON.stringify({
					...downloadObj.toDict(),
					status: "inQueue",
					requestedBy,
				})
			);

			slimmedObjects.push(downloadObj.getSlimmedDict());
		});
		if (slimmedObjects.length === 1)
			this.listener.send("addedToQueue", slimmedObjects[0]);
		else this.listener.send("addedToQueue", slimmedObjects);

		this.startQueue(dz);
		return slimmedObjects;
	}

	async startQueue(dz: Deezer) {
		do {
			if (this.currentJob !== null || this.queueOrder.length === 0) {
				// Should not start another download
				return null;
			}
			this.currentJob = true; // lock currentJob

			let currentUUID: string;
			do {
				currentUUID = this.queueOrder.shift() || "";
			} while (this.queue[currentUUID] === undefined && this.queueOrder.length);
			if (this.queue[currentUUID] === undefined) {
				fs.writeFileSync(
					configFolder + `queue${sep}order.json`,
					JSON.stringify(this.queueOrder)
				);
				this.currentJob = null;
				return null;
			}
			this.queue[currentUUID].status = "downloading";
			const currentItem = JSON.parse(
				fs
					.readFileSync(configFolder + `queue${sep}${currentUUID}.json`)
					.toString()
			);
			const requestedBy: string =
				currentItem.requestedBy ||
				this.queue[currentUUID]?.requestedBy ||
				"unknown";
			let downloadObject: Single | Collection | Convertable | undefined =
				undefined;

			switch (currentItem.__type__) {
				case "Single":
					downloadObject = new Single(currentItem);
					break;
				case "Collection":
					downloadObject = new Collection(currentItem);
					break;
				case "Convertable": {
					const convertable = new Convertable(currentItem);
					downloadObject = await this.plugins[convertable.plugin].convert(
						dz,
						convertable,
						this.settings,
						this.listener
					);
					fs.writeFileSync(
						configFolder + `queue${sep}${downloadObject.uuid}.json`,
						JSON.stringify({ ...downloadObject.toDict(), status: "inQueue" })
					);
					break;
				}
			}

			if (typeof downloadObject === "undefined") return;

			this.currentJob = new Downloader(
				dz,
				downloadObject,
				this.settings,
				this.listener
			);

			this.listener.send("startDownload", currentUUID);
			await this.currentJob.start();

			if (!downloadObject.isCanceled) {
				// Set status
				if (
					downloadObject.failed === downloadObject.size &&
					downloadObject.size !== 0
				) {
					this.queue[currentUUID].status = "failed";
				} else if (downloadObject.failed > 0) {
					this.queue[currentUUID].status = "withErrors";
				} else {
					this.queue[currentUUID].status = "completed";
				}

				// Persist per-track history records for this finished job.
				this.recordHistory(downloadObject, requestedBy);

				const savedObject = {
					...downloadObject.getSlimmedDict(),
					status: this.queue[currentUUID].status,
					requestedBy,
				};
				// Save queue status
				this.queue[currentUUID] = savedObject;
				fs.writeFileSync(
					configFolder + `queue${sep}${currentUUID}.json`,
					JSON.stringify(savedObject)
				);
			}

			fs.writeFileSync(
				configFolder + `queue${sep}order.json`,
				JSON.stringify(this.queueOrder)
			);

			this.currentJob = null;
		} while (this.queueOrder.length);
	}

	/**
	 * Write one history row per track for a finished job, reading the file paths
	 * and per-track results the Downloader already recorded on the download
	 * object (`files` for successes, `errors` for per-track failures). The core
	 * `deemix` package is untouched. DB failures are swallowed so they can never
	 * break a download.
	 */
	recordHistory(downloadObject: any, requestedBy: string) {
		try {
			const type: string = downloadObject.type;
			const parentId = downloadObject.id;
			const uuid: string = downloadObject.uuid;
			const bitrate: number = downloadObject.bitrate;
			// Album name is only reliably known for album jobs (best-effort).
			const album = type === "album" ? downloadObject.title : null;
			// The collection name (album/playlist title) groups tracks in the
			// Library view, including for playlists and single tracks.
			const parentTitle: string | null = downloadObject.title ?? null;

			const records: DownloadRecord[] = [];

			for (const file of downloadObject.files || []) {
				if (!file || !file.data || file.data.id == null) continue;
				records.push({
					deezerId: file.data.id,
					parentId,
					type,
					title: file.data.title ?? null,
					artist: file.data.artist ?? null,
					album,
					parentTitle,
					path: file.path ?? null,
					status: "success",
					requestedBy,
					bitrate,
					uuid,
				});
			}

			for (const err of downloadObject.errors || []) {
				// Skip post-processing errors; only per-track failures get a row.
				if (err.type && err.type !== "track") continue;
				const data = err.data || {};
				records.push({
					deezerId: data.id ?? "0",
					parentId,
					type,
					title: data.title ?? null,
					artist: data.artist ?? null,
					album,
					parentTitle,
					path: null,
					status: "failed",
					requestedBy,
					bitrate,
					uuid,
				});
			}

			addDownloadRecords(records);
		} catch (e) {
			logger.error("Failed to record download history");
			logger.error(e);
		}
	}

	cancelDownload(uuid: string) {
		if (Object.keys(this.queue).includes(uuid)) {
			switch (this.queue[uuid].status) {
				case "downloading":
					if (this.currentJob instanceof Downloader) {
						this.currentJob.downloadObject.isCanceled = true;
					}
					this.listener.send("cancellingCurrentItem", uuid);
					break;
				case "inQueue":
					this.queueOrder.splice(this.queueOrder.indexOf(uuid), 1);
					fs.writeFileSync(
						configFolder + `queue${sep}order.json`,
						JSON.stringify(this.queueOrder)
					);
					this.listener.send("removedFromQueue", { uuid });
					break;

				default:
					this.listener.send("removedFromQueue", { uuid });
					break;
			}
			fs.unlinkSync(configFolder + `queue${sep}${uuid}.json`);
			delete this.queue[uuid];
		}
	}

	cancelAllDownloads() {
		this.queueOrder = [];
		let currentItem: string | null = null;
		Object.values(this.queue).forEach((downloadObject: any) => {
			if (downloadObject.status === "downloading") {
				if (this.currentJob instanceof Downloader) {
					this.currentJob.downloadObject.isCanceled = true;
				}

				this.listener.send("cancellingCurrentItem", downloadObject.uuid);
				currentItem = downloadObject.uuid;
			}
			fs.unlinkSync(configFolder + `queue${sep}${downloadObject.uuid}.json`);
			delete this.queue[downloadObject.uuid];
		});
		fs.writeFileSync(
			configFolder + `queue${sep}order.json`,
			JSON.stringify(this.queueOrder)
		);
		this.listener.send("removedAllDownloads", currentItem);
	}

	clearCompletedDownloads() {
		Object.values(this.queue).forEach((downloadObject: any) => {
			if (downloadObject.status === "completed") {
				fs.unlinkSync(configFolder + `queue${sep}${downloadObject.uuid}.json`);
				delete this.queue[downloadObject.uuid];
			}
		});
		this.listener.send("removedFinishedDownloads");
	}

	restoreQueueFromDisk() {
		if (!fs.existsSync(configFolder + "queue"))
			fs.mkdirSync(configFolder + "queue");
		const allItems: string[] = fs.readdirSync(configFolder + "queue");
		allItems.forEach((filename: string) => {
			if (filename === "order.json") {
				try {
					this.queueOrder = JSON.parse(
						fs.readFileSync(configFolder + `queue${sep}order.json`).toString()
					);
				} catch {
					this.queueOrder = [];
					fs.writeFileSync(
						configFolder + `queue${sep}order.json`,
						JSON.stringify(this.queueOrder)
					);
				}
			} else {
				let currentItem: any;
				try {
					currentItem = JSON.parse(
						fs.readFileSync(configFolder + `queue${sep}${filename}`).toString()
					);
				} catch {
					fs.unlinkSync(configFolder + `queue${sep}${filename}`);
					return;
				}
				if (currentItem.status === "inQueue") {
					let downloadObject: any;
					switch (currentItem.__type__) {
						case "Single":
							downloadObject = new Single(currentItem);
							// Remove old incompatible queue items
							if (downloadObject.single.trackAPI_gw) {
								fs.unlinkSync(configFolder + `queue${sep}${filename}`);
								return;
							}
							break;
						case "Collection":
							downloadObject = new Collection(currentItem);
							// Remove old incompatible queue items
							if (downloadObject.collection.tracks_gw) {
								fs.unlinkSync(configFolder + `queue${sep}${filename}`);
								return;
							}
							break;
						case "Convertable":
							downloadObject = new Convertable(currentItem);
							break;
					}
					this.queue[downloadObject.uuid] = downloadObject.getEssentialDict();
					this.queue[downloadObject.uuid].status = "inQueue";
					this.queue[downloadObject.uuid].requestedBy = currentItem.requestedBy;
				} else {
					this.queue[currentItem.uuid] = currentItem;
				}
			}
		});
	}
}
