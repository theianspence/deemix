<script setup lang="ts">
import { isEmpty } from "lodash-es";
import DownloadIndicator from "@/components/globals/DownloadIndicator.vue";
import { pinia } from "@/stores";
import { useUserStore } from "@/stores/user";
import { sendAddToQueue } from "@/utils/downloads";
import { useDownloadStatus, markStatusDownloaded, lastCompletedAlbumId } from "@/use/download-status";
import { convertDuration } from "@/utils/utils";
import { emitter } from "@/utils/emitter";
import { useI18n } from "vue-i18n";
import { computed, onMounted, ref, watch } from "vue";

const { t } = useI18n();
const userStore = useUserStore(pinia);

const { getStatus, loadStatuses } = useDownloadStatus();
function loadTrackStatuses(tracks) {
	if (!tracks) return;
	const ids = tracks
		.filter((track) => track && track.type === "track" && track.id != null)
		.map((track) => track.id);
	loadStatuses(ids);
}

const title = ref("");
const metadata = ref("");
const release_date = ref("");
const label = ref("");
const explicit = ref(false);
const image = ref("");
const type = ref("empty");
const link = ref("");
const body = ref([]);
const currentAlbumId = ref<string | null>(null);

// Albums download for everyone; playlists (and spotify playlists) require the
// caller's playlist-download permission.
const canDownloadThis = computed(
	() => type.value === "album" || userStore.canDownloadPlaylists
);

function playPausePreview(e) {
	emitter.emit("trackPreview:playPausePreview", e);
}
function trackDownloadLink(track) {
	return type.value === "spotifyPlaylist"
		? track.uri
		: `https://www.deezer.com/track/${track.id}`;
}
function reset() {
	title.value = "Loading...";
	image.value = "";
	metadata.value = "";
	label.value = "";
	release_date.value = "";
	explicit.value = false;
	type.value = "empty";
	body.value = [];
}
function addToQueue(e) {
	sendAddToQueue(e.currentTarget.dataset.link);
}
function showAlbum(data) {
	reset();

	const {
		id: albumID,
		title: albumTitle,
		explicit_lyrics,
		label: albumLabel,
		artist: { name: artistName },
		tracks: albumTracks,
		nb_tracks: numberOfTracks,
		release_date: albumReleaseDate,
		cover_xl,
	} = data;

	type.value = "album";
	currentAlbumId.value = String(albumID);
	link.value = `https://www.deezer.com/album/${albumID}`;
	title.value = albumTitle;
	explicit.value = explicit_lyrics;
	label.value = albumLabel;
	metadata.value = `${artistName} • ${t(
		"globals.listTabs.trackN",
		numberOfTracks
	)}`;
	release_date.value = albumReleaseDate.substring(0, 10);
	image.value = cover_xl;

	if (isEmpty(albumTracks)) {
		body.value = null;
	} else {
		body.value = albumTracks;
		loadTrackStatuses(albumTracks);
	}
}
function showPlaylist(data) {
	reset();

	const {
		id: playlistID,
		title: playlistTitle,
		picture_xl: playlistCover,
		creation_date,
		creator: { name: creatorName },
		tracks: playlistTracks,
		tracks: { length: numberOfTracks },
	} = data;

	type.value = "playlist";
	link.value = `https://www.deezer.com/playlist/${playlistID}`;
	title.value = playlistTitle;
	image.value = playlistCover;
	release_date.value = creation_date.substring(0, 10);
	metadata.value = `${t("globals.by", {
		artist: creatorName,
	})} • ${t("globals.listTabs.trackN", numberOfTracks)}`;

	if (isEmpty(playlistTracks)) {
		body.value = null;
	} else {
		body.value = playlistTracks;
		loadTrackStatuses(playlistTracks);
	}
}
function showSpotifyPlaylist(data) {
	reset();

	const {
		uri: playlistURI,
		name: playlistName,
		images,
		images: { length: numberOfImages },
		owner: { display_name: ownerName },
		tracks: playlistTracks,
		tracks: { length: numberOfTracks },
	} = data;

	type.value = "spotifyPlaylist";
	link.value = playlistURI;
	title.value = playlistName;
	image.value = numberOfImages
		? images[0].url
		: "https://e-cdns-images.dzcdn.net/images/cover/d41d8cd98f00b204e9800998ecf8427e/1000x1000-000000-80-0-0.jpg";
	release_date.value = "";
	metadata.value = `${t("globals.by", {
		artist: ownerName,
	})} • ${t("globals.listTabs.trackN", numberOfTracks)}`;

	if (isEmpty(playlistTracks)) {
		body.value = null;
	} else {
		body.value = playlistTracks;
	}
}

// When the full album finishes downloading, mark every visible track row as
// downloaded directly in the shared status map — no DB round-trip needed.
watch(lastCompletedAlbumId, (completedId) => {
	if (!completedId || completedId !== currentAlbumId.value) return;
	const ids = (body.value as any[])
		.filter((t) => t?.type === "track" && t.id != null)
		.map((t) => String(t.id));
	ids.forEach((id) => markStatusDownloaded(id, "downloadStatus"));
});

onMounted(() => {
	emitter.on("showAlbum", showAlbum);
	emitter.on("showPlaylist", showPlaylist);
	emitter.on("showSpotifyPlaylist", showSpotifyPlaylist);
});
</script>

<template>
	<div ref="root" class="fixed-footer bg-background-main image-header relative">
		<header
			:style="{
				'background-image':
					'linear-gradient(to bottom, transparent 0%, var(--main-background) 100%), url(\'' +
					image +
					'\')',
			}"
		>
			<h1 class="m-0 flex items-center text-5xl">
				{{ title }}
				<i v-if="explicit" class="material-icons title-icon title-icon--right"
					>explicit</i
				>
			</h1>

			<h2 class="m-0 mb-3 text-lg">
				<p v-if="metadata">{{ metadata }}</p>
				<p v-if="release_date">{{ release_date }}</p>
			</h2>
		</header>

		<table class="table--tracklist table">
			<thead>
				<tr>
					<th>
						<i class="material-icons">music_note</i>
					</th>
					<th>#</th>
					<th>{{ t("globals.listTabs.title", 1) }}</th>
					<th>{{ t("globals.listTabs.artist", 1) }}</th>
					<th v-if="type === 'playlist'">
						{{ t("globals.listTabs.album", 1) }}
					</th>
					<th>
						<i class="material-icons">timer</i>
					</th>
					<th v-if="userStore.canDownloadTracks"></th>
				</tr>
			</thead>
			<tbody>
				<template v-if="type !== 'spotifyPlaylist'">
					<template v-for="track in body">
						<tr v-if="track.type === 'track'" :key="track.id">
							<td class="table__cell--x-small table__cell--center">
								<div
									class="table__cell-content table__cell-content--vertical-center"
								>
									<i
										:class="{
											preview_playlist_controls: track.preview,
											'cursor-pointer': track.preview,
											disabled: !track.preview,
										}"
										:data-preview="track.preview"
										:data-link-only="track.link"
										:title="t('globals.play_hint')"
										class="material-icons"
										v-on="{ click: track.preview ? playPausePreview : false }"
									>
										play_arrow
									</i>
								</div>
							</td>
							<td class="table__cell--small table__cell--center track_position">
								{{
									type === "album"
										? track.track_position
										: body.indexOf(track) + 1
								}}
							</td>
							<td class="table__cell--large table__cell--with-icon">
								<div
									class="table__cell-content table__cell-content--vertical-center"
								>
									<DownloadIndicator :status="getStatus(track.id)" />
									<i
										v-if="track.explicit_lyrics"
										class="material-icons title-icon"
									>
										explicit
									</i>
									{{
										track.title +
										(track.title_version &&
										track.title.indexOf(track.title_version) == -1
											? " " + track.title_version
											: "")
									}}
								</div>
							</td>
							<router-link
								v-slot="{ navigate }"
								:to="{ name: 'Artist', params: { id: track.artist.id } }"
								custom
							>
								<td
									role="link"
									class="table__cell--medium table__cell--center cursor-pointer"
									@click="navigate"
								>
									{{ track.artist.name }}
								</td>
							</router-link>
							<router-link
								v-if="type === 'playlist'"
								v-slot="{ navigate }"
								:to="{ name: 'Album', params: { id: track.album.id } }"
								custom
							>
								<td
									role="link"
									class="table__cell--medium table__cell--center cursor-pointer"
									@click="navigate"
								>
									{{ track.album.title }}
								</td>
							</router-link>
							<td
								:class="{
									'table__cell--small': type === 'album',
									'table__cell--x-small': type === 'playlist',
								}"
								class="table__cell--center"
							>
								{{ convertDuration(track.duration) }}
							</td>
							<td
								v-if="userStore.canDownloadTracks"
								class="table__cell--center group cursor-pointer"
								:data-link="trackDownloadLink(track)"
								aria-label="download"
								@click.stop="addToQueue"
							>
								<i
									class="material-icons group-hover:text-primary transition-colors"
									:title="t('globals.download_hint')"
								>
									get_app
								</i>
							</td>
						</tr>
						<tr
							v-else-if="track.type == 'disc_separator'"
							:key="track.id + '_disc_separator'"
							class="table__row-no-highlight"
							style="opacity: 0.54"
						>
							<td>
								<div
									class="table__cell-content table__cell-content--vertical-center"
									style="opacity: 0.54"
								>
									<i class="material-icons">album</i>
								</div>
							</td>
							<td class="table__cell--center">
								{{ track.number }}
							</td>
							<td :colspan="userStore.canDownloadTracks ? 4 : 3"></td>
						</tr>
					</template>
				</template>
				<template v-else>
					<tr v-for="(track, i) in body" :key="track.id">
						<td>
							<i
								v-if="track.preview_url"
								:class="{
									preview_playlist_controls: track.preview_url,
									'cursor-pointer': track.preview_url,
								}"
								:data-preview="track.preview_url"
								:title="t('globals.play_hint')"
								class="material-icons"
								@click="playPausePreview"
							>
								play_arrow
							</i>
							<i v-else class="material-icons disabled">play_arrow</i>
						</td>
						<td>{{ i + 1 }}</td>
						<td class="flex items-center">
							<i v-if="track.explicit" class="material-icons title-icon"
								>explicit</i
							>
							{{ track.name }}
						</td>
						<td>{{ track.artists[0].name }}</td>
						<td>{{ track.album.name }}</td>
						<td>{{ convertDuration(Math.floor(track.duration_ms / 1000)) }}</td>
						<td
							v-if="userStore.canDownloadTracks"
							class="group cursor-pointer"
							:data-link="track.uri"
							aria-label="download"
							@click.stop="addToQueue"
						>
							<i
								class="material-icons group-hover:text-primary transition-colors"
								:title="t('globals.download_hint')"
							>
								get_app
							</i>
						</td>
					</tr>
				</template>
			</tbody>
		</table>
		<span
			v-if="label"
			style="
				opacity: 0.4;
				margin-top: 8px;
				display: inline-block;
				font-size: 13px;
			"
			>{{ label }}</span
		>
		<footer class="bg-background-main">
			<button
				v-if="canDownloadThis"
				:data-link="link"
				class="btn btn-primary flex items-center"
				@click.stop="addToQueue"
			>
				{{
					`${t("globals.download", {
						thing: t(`globals.listTabs.${type}`, 1),
					})}`
				}}<i class="material-icons ml-2">file_download</i>
			</button>
			<span v-else class="opacity-60">
				{{ t("tracklist.playlistDownloadDisabled") }}
			</span>
		</footer>
	</div>
</template>
