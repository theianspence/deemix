import connect from "./connect.js";
import analyzeLink from "./analyzeLink.js";
import getHome from "./getHome.js";
import getCharts from "./getCharts.js";
import mainSearch from "./mainSearch.js";
import search from "./search.js";
import newReleases from "./newReleases.js";
import getTracklist from "./getTracklist.js";
import { apiHandler as albumSearch } from "./albumSearch.js";
import getChartTracks from "./getChartTracks.js";
import getSettings from "./getSettings.js";
import getUserTracks from "./getUserTracks.js";
import getUserAlbums from "./getUserAlbums.js";
import getUserArtists from "./getUserArtists.js";
import getUserPlaylists from "./getUserPlaylists.js";
import getUserSpotifyPlaylists from "./getUserSpotifyPlaylists.js";
import getUserFavorites from "./getUserFavorites.js";
import getQueue from "./getQueue.js";
import spotifyStatus from "./spotifyStatus.js";
import checkForUpdates from "./checkForUpdates.js";
import me from "./me.js";
import getHistory from "./getHistory.js";
import getLibrary from "./getLibrary.js";
import getLibraryTracks from "./getLibraryTracks.js";
import downloadStatus from "./downloadStatus.js";
import albumStatus from "./albumStatus.js";
import adminStats from "./adminStats.js";

export default [
	connect,
	albumSearch,
	analyzeLink,
	getHome,
	getCharts,
	getChartTracks,
	mainSearch,
	search,
	newReleases,
	getTracklist,
	getSettings,
	getUserTracks,
	getUserAlbums,
	getUserArtists,
	getUserPlaylists,
	getUserSpotifyPlaylists,
	getUserFavorites,
	getQueue,
	spotifyStatus,
	checkForUpdates,
	me,
	getHistory,
	getLibrary,
	getLibraryTracks,
	downloadStatus,
	albumStatus,
	adminStats,
];
