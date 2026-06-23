<script setup lang="ts">
import { pinia } from "@/stores";
import { useLibraryStore, type LibraryEntry } from "@/stores/library";
import { useUserStore } from "@/stores/user";
import { useDownloadStatus } from "@/use/download-status";
import { fetchData } from "@/utils/api-utils";
import { sendAddToQueue } from "@/utils/downloads";
import { toast } from "@/utils/toasts";
import { socket } from "@/utils/socket";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

interface TrackRow {
	deezerId: string;
	title: string;
	artist: string;
	trackNumber: number;
	duration: number;
	explicit: boolean;
	status: "downloaded" | "missing" | "none";
	fileExists: boolean;
	deezerLink: string;
	dbId: number | null;
	path: string | null;
}

const { t } = useI18n();
const userStore = useUserStore(pinia);
const libraryStore = useLibraryStore(pinia);
const { statusMap: trackStatusMap } = useDownloadStatus("downloadStatus");

const search = ref("");
const failedCovers = ref<Set<string>>(new Set());

const entries = computed(() => libraryStore.entries);
const loading = computed(() => libraryStore.loading);

const groupedByArtist = computed(() => {
	const groups: Record<string, LibraryEntry[]> = {};
	for (const entry of entries.value) {
		const artist = entry.artist || "Unknown Artist";
		if (!groups[artist]) groups[artist] = [];
		groups[artist].push(entry);
	}
	return Object.entries(groups).sort(([a], [b]) =>
		a.localeCompare(b, undefined, { sensitivity: "base" })
	);
});

const selected = ref<LibraryEntry | null>(null);
const tracks = ref<TrackRow[]>([]);
const tracksLoading = ref(false);

// Overlay the shared live status map so track icons update as downloads finish.
const displayTracks = computed(() =>
	tracks.value.map((t) => ({
		...t,
		status: (trackStatusMap.value[t.deezerId] as TrackRow["status"]) ?? t.status,
	}))
);

function coverUrl(entry: LibraryEntry): string | null {
	if (failedCovers.value.has(entry.key)) return null;
	if (entry.type === "album")
		return `https://api.deezer.com/album/${entry.key}/image?size=big`;
	if (entry.type === "playlist")
		return `https://api.deezer.com/playlist/${entry.key}/image?size=big`;
	return null; // single tracks have no reliable cover key
}

function onCoverError(entry: LibraryEntry) {
	failedCovers.value = new Set(failedCovers.value).add(entry.key);
}

function statusClass(status: string) {
	return `lib-status--${status}`;
}

function canDelete(entry: LibraryEntry) {
	return userStore.isAdmin || entry.owners.includes(userStore.username ?? "");
}

async function openAlbum(entry: LibraryEntry) {
	selected.value = entry;
	tracks.value = [];
	tracksLoading.value = true;
	try {
		const result = await fetchData("library/tracks", {
			key: entry.key,
			type: entry.type,
		});
		tracks.value = result.tracks ?? [];
	} catch (e) {
		console.error(e);
	} finally {
		tracksLoading.value = false;
	}
}

function closeModal() {
	selected.value = null;
}

async function deleteAlbum(entry: LibraryEntry) {
	if (!window.confirm(t("library.deleteConfirm", { title: entry.title })))
		return;
	try {
		const result = await fetchData(
			"library",
			{ key: entry.key, type: entry.type },
			"DELETE"
		);
		if (result?.result) {
			socket.emit("cancelByDeezerID", { id: entry.key, type: entry.type });
			libraryStore.removeEntry(entry.key, entry.type);
			if (selected.value?.key === entry.key) closeModal();
			toast(t("library.deleted"), "delete", true);
		} else {
			toast(t("library.deleteFailed"), "close", true);
		}
	} catch {
		toast(t("library.deleteFailed"), "close", true);
	}
}

function downloadTrack(track: TrackRow) {
	sendAddToQueue(track.deezerLink);
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => libraryStore.fetch(search.value), 300);
});

onMounted(() => {
	libraryStore.fetch();
});
</script>

<template>
	<div class="p-6">
		<div class="mb-6 flex items-center justify-between gap-4">
			<h1 class="text-4xl">{{ t("library.title") }}</h1>
			<input
				v-model="search"
				type="text"
				class="lib-search"
				:placeholder="t('library.searchPlaceholder')"
			/>
		</div>

		<p v-if="!loading && entries.length === 0" class="opacity-70">
			{{ t("library.empty") }}
		</p>

		<div v-else class="lib-artists">
			<section
				v-for="[artist, albums] in groupedByArtist"
				:key="artist"
				class="lib-artist-section"
			>
				<h2 class="lib-artist-heading">{{ artist }}</h2>
				<div class="lib-grid">
					<div
						v-for="entry in albums"
						:key="entry.type + entry.key"
						class="lib-card"
						@click="openAlbum(entry)"
					>
						<div class="lib-cover">
							<img
								v-if="coverUrl(entry)"
								:src="coverUrl(entry)!"
								:alt="entry.title"
								loading="lazy"
								@error="onCoverError(entry)"
							/>
							<i v-else class="material-icons lib-cover__fallback">album</i>

							<span
								class="lib-badge"
								:class="statusClass(entry.status)"
								:title="t('library.status.' + entry.status)"
							>
								{{ t("library.status." + entry.status) }}
							</span>

							<i
								v-if="canDelete(entry)"
								class="material-icons lib-delete"
								:title="t('library.deleteAlbum')"
								@click.stop="deleteAlbum(entry)"
							>
								delete
							</i>
						</div>

						<div class="lib-title" :title="entry.title">{{ entry.title }}</div>
						<div class="lib-meta">
							{{ t("library.trackCount", { n: entry.trackCount }) }}
							<template v-if="entry.failedCount">
								· {{ t("library.failedCount", { n: entry.failedCount }) }}
							</template>
						</div>
						<div class="lib-meta lib-meta--sub">{{ entry.requestedBy }}</div>
					</div>
				</div>
			</section>
		</div>

		<!-- Album detail modal (teleported to body so position:fixed is relative
		     to the viewport, not a transformed ancestor) -->
		<Teleport to="body">
			<div v-if="selected" class="lib-modal" @click.self="closeModal">
				<div class="lib-modal__panel">
					<header class="lib-modal__header">
						<div>
							<h2 class="text-2xl">{{ selected.title }}</h2>
							<p class="opacity-70">
								{{ selected.artist }} ·
								{{ t("library.trackCount", { n: selected.trackCount }) }} ·
								{{ selected.requestedBy }}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<button
								v-if="canDelete(selected)"
								class="btn btn-primary"
								@click="deleteAlbum(selected)"
							>
								{{ t("library.deleteAlbum") }}
							</button>
							<i class="material-icons lib-modal__close" @click="closeModal"
								>close</i
							>
						</div>
					</header>

					<p v-if="tracksLoading" class="opacity-70">…</p>
					<table v-else class="table w-full">
						<tbody>
							<tr v-for="track in displayTracks" :key="track.deezerId">
								<td class="lib-track-status">
									<i
										class="material-icons"
										:class="statusClass(track.status)"
										:title="t('library.status.' + track.status)"
									>
										{{
											track.status === "downloaded"
												? "check_circle"
												: track.status === "missing"
													? "error_outline"
													: "radio_button_unchecked"
										}}
									</i>
								</td>
								<td class="break-words">{{ track.title || "—" }}</td>
								<td class="break-words opacity-70">{{ track.artist || "" }}</td>
								<td class="lib-track-download">
									<i
										v-if="track.status !== 'downloaded' && userStore.canDownloadTracks"
										class="material-icons lib-track-dl-btn"
										title="Download track"
										@click.stop="downloadTrack(track)"
									>
										download
									</i>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
.lib-artists {
	display: flex;
	flex-direction: column;
	gap: 2.5rem;
}

.lib-artist-section {
	/* no extra spacing needed — gap handles it */
}

.lib-artist-heading {
	font-size: 1.25rem;
	font-weight: 700;
	margin-bottom: 0.75rem;
	padding-bottom: 0.4rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	letter-spacing: 0.01em;
}

.lib-search {
	background: var(--secondary-background);
	color: var(--foreground);
	border: none;
	border-radius: 12px;
	padding: 8px 14px;
	min-width: 16rem;
}

.lib-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
	gap: 1.25rem;
}

.lib-card {
	cursor: pointer;
	transition: transform 0.12s ease;
}
.lib-card:hover {
	transform: translateY(-3px);
}

.lib-cover {
	position: relative;
	width: 100%;
	aspect-ratio: 1 / 1;
	border-radius: 10px;
	overflow: hidden;
	background: var(--secondary-background);
	display: flex;
	align-items: center;
	justify-content: center;
}
.lib-cover img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.lib-cover__fallback {
	font-size: 3rem;
	opacity: 0.4;
}

.lib-badge {
	position: absolute;
	top: 6px;
	left: 6px;
	font-size: 0.72rem;
	font-weight: 700;
	padding: 3px 9px;
	border-radius: 999px;
	color: #fff;
	text-transform: capitalize;
	line-height: 1;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
/* Amber backgrounds need dark text to be legible. */
.lib-badge.lib-status--partial,
.lib-badge.lib-status--missing {
	color: #111;
}
.lib-status--downloaded {
	color: #1db954;
}
.lib-badge.lib-status--downloaded {
	background: #1db954;
	color: #fff;
}
.lib-status--partial,
.lib-status--missing {
	color: #e0a800;
}
.lib-badge.lib-status--partial,
.lib-badge.lib-status--missing {
	background: #e0a800;
}
.lib-status--failed {
	color: #e0524b;
}
.lib-badge.lib-status--failed {
	background: #e0524b;
}

.lib-delete {
	position: absolute;
	top: 6px;
	right: 6px;
	color: #fff;
	background: rgba(0, 0, 0, 0.55);
	border-radius: 999px;
	padding: 4px;
	font-size: 1.1rem;
	opacity: 0;
	transition: opacity 0.12s ease;
}
.lib-card:hover .lib-delete {
	opacity: 1;
}
.lib-delete:hover {
	background: #e0524b;
}

.lib-title {
	margin-top: 0.5rem;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.lib-meta {
	opacity: 0.55;
	font-size: 0.8rem;
}
.lib-meta--sub {
	opacity: 0.45;
}

.lib-modal {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.65);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 1000;
	padding: 1rem;
}
.lib-modal__panel {
	background: var(--panels-bg, var(--main-background, #1e1e1e));
	color: var(--foreground, #fff);
	border-radius: 14px;
	width: min(640px, 100%);
	max-height: 85vh;
	overflow-y: auto;
	padding: 1.5rem;
	box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.lib-modal__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: 1rem;
}
.lib-modal__close {
	cursor: pointer;
	opacity: 0.7;
}
.lib-modal__close:hover {
	opacity: 1;
}
.lib-track-status {
	width: 2rem;
	text-align: center;
}
.lib-track-status i {
	font-size: 1.1rem;
	vertical-align: middle;
}
.lib-track-download {
	width: 2rem;
	text-align: right;
}
.lib-track-dl-btn {
	font-size: 1.1rem;
	vertical-align: middle;
	cursor: pointer;
	opacity: 0.4;
	transition: opacity 0.1s;
}
.lib-track-dl-btn:hover {
	opacity: 1;
	color: var(--primary-color, #1db954);
}
</style>
