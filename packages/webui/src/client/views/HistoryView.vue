<script setup lang="ts">
import { pinia } from "@/stores";
import { useUserStore } from "@/stores/user";
import { fetchData } from "@/utils/api-utils";
import { toast } from "@/utils/toasts";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

interface HistoryRow {
	id: number;
	deezer_id: string;
	parent_id: string | null;
	type: string;
	title: string | null;
	artist: string | null;
	album: string | null;
	path: string | null;
	status: string;
	requested_by: string;
	bitrate: number | null;
	created_at: number;
	fileExists: boolean;
}

const { t } = useI18n();
const userStore = useUserStore(pinia);

const rows = ref<HistoryRow[]>([]);
const total = ref(0);
const search = ref("");
const sort = ref("created_at");
const order = ref<"asc" | "desc">("desc");
const page = ref(0);
const pageSize = 50;
const loading = ref(false);

const columns: { key: string; label: string; sortable: boolean }[] = [
	{ key: "title", label: "history.columns.title", sortable: true },
	{ key: "artist", label: "history.columns.artist", sortable: true },
	{ key: "album", label: "history.columns.album", sortable: true },
	{ key: "type", label: "history.columns.type", sortable: true },
	{ key: "requested_by", label: "history.columns.requestedBy", sortable: true },
	{ key: "created_at", label: "history.columns.date", sortable: true },
	{ key: "status", label: "history.columns.status", sortable: true },
];

const hasMore = computed(() => (page.value + 1) * pageSize < total.value);

async function fetchHistory() {
	loading.value = true;
	try {
		const result = await fetchData("history", {
			search: search.value,
			sort: sort.value,
			order: order.value,
			limit: pageSize,
			offset: page.value * pageSize,
		});
		rows.value = result.rows ?? [];
		total.value = result.total ?? 0;
	} catch (e) {
		console.error(e);
	} finally {
		loading.value = false;
	}
}

function sortBy(column: string) {
	if (sort.value === column) {
		order.value = order.value === "asc" ? "desc" : "asc";
	} else {
		sort.value = column;
		order.value = "asc";
	}
	page.value = 0;
	fetchHistory();
}

function canDelete(row: HistoryRow) {
	return userStore.isAdmin || row.requested_by === userStore.username;
}

async function remove(row: HistoryRow) {
	try {
		const result = await fetchData("history", { id: row.id }, "DELETE");
		if (result?.result) {
			rows.value = rows.value.filter((r) => r.id !== row.id);
			total.value = Math.max(0, total.value - 1);
			toast(t("history.deleted"), "delete", true);
		} else {
			toast(t("history.deleteFailed"), "close", true);
		}
	} catch {
		toast(t("history.deleteFailed"), "close", true);
	}
}

function statusLabel(row: HistoryRow) {
	if (row.status === "failed") return t("history.status.failed");
	if (row.status === "success" && !row.fileExists)
		return t("history.status.missing");
	return t("history.status.downloaded");
}

function statusClass(row: HistoryRow) {
	if (row.status === "failed") return "history-status--failed";
	if (row.status === "success" && !row.fileExists)
		return "history-status--missing";
	return "history-status--downloaded";
}

function formatDate(ts: number) {
	return new Date(ts).toLocaleString();
}

function nextPage() {
	if (hasMore.value) {
		page.value += 1;
		fetchHistory();
	}
}

function prevPage() {
	if (page.value > 0) {
		page.value -= 1;
		fetchHistory();
	}
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		page.value = 0;
		fetchHistory();
	}, 300);
});

onMounted(fetchHistory);
</script>

<template>
	<div class="p-6">
		<div class="mb-6 flex items-center justify-between">
			<h1 class="text-4xl">{{ t("history.title") }}</h1>
			<input
				v-model="search"
				type="text"
				class="search-input"
				:placeholder="t('history.searchPlaceholder')"
			/>
		</div>

		<p v-if="!loading && rows.length === 0" class="opacity-70">
			{{ t("history.empty") }}
		</p>

		<table v-else class="table w-full">
			<thead>
				<tr class="capitalize">
					<th
						v-for="col in columns"
						:key="col.key"
						class="h-12 cursor-pointer pb-3 text-left"
						@click="col.sortable && sortBy(col.key)"
					>
						{{ t(col.label) }}
						<span v-if="sort === col.key">
							{{ order === "asc" ? "▲" : "▼" }}
						</span>
					</th>
					<th class="h-12 pb-3"></th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.id">
					<td class="break-words">{{ row.title || "—" }}</td>
					<td class="break-words">{{ row.artist || "—" }}</td>
					<td class="break-words">{{ row.album || "—" }}</td>
					<td class="capitalize">{{ row.type }}</td>
					<td>{{ row.requested_by }}</td>
					<td>{{ formatDate(row.created_at) }}</td>
					<td>
						<span class="history-status" :class="statusClass(row)">
							{{ statusLabel(row) }}
						</span>
					</td>
					<td class="text-center">
						<i
							v-if="canDelete(row)"
							class="material-icons cursor-pointer opacity-70 hover:text-red-500 hover:opacity-100"
							:title="t('history.delete')"
							@click="remove(row)"
						>
							delete
						</i>
					</td>
				</tr>
			</tbody>
		</table>

		<div
			v-if="total > pageSize"
			class="mt-4 flex items-center justify-center gap-4"
		>
			<button class="btn btn-primary" :disabled="page === 0" @click="prevPage">
				{{ t("history.prev") }}
			</button>
			<span class="opacity-70">
				{{ t("history.pageInfo", { page: page + 1, total }) }}
			</span>
			<button class="btn btn-primary" :disabled="!hasMore" @click="nextPage">
				{{ t("history.next") }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.search-input {
	background: var(--secondary-background);
	color: var(--foreground);
	border: none;
	border-radius: 12px;
	padding: 8px 14px;
	min-width: 16rem;
}

.history-status {
	font-weight: 600;
}

.history-status--downloaded {
	color: #1db954;
}

.history-status--missing {
	color: #e0a800;
}

.history-status--failed {
	color: #e0524b;
}
</style>
