<script setup lang="ts">
import { pinia } from "@/stores";
import { useLoginStore } from "@/stores/login";
import { fetchData, postToServer } from "@/utils/api-utils";
import { toast } from "@/utils/toasts";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

interface AdminStats {
	totalDownloads: number;
	perUser: { user: string; count: number }[];
	diskUsage: number;
	downloadDir: string;
}

const { t } = useI18n();
const loginStore = useLoginStore(pinia);

const stats = ref<AdminStats | null>(null);
const arlInput = ref("");
const loggingIn = ref(false);

const currentUser = computed(() => loginStore.user);
const isLoggedIn = computed(() => !!loginStore.user?.id);

function humanBytes(bytes: number) {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

async function loadStats() {
	try {
		stats.value = await fetchData("admin/stats");
	} catch (e) {
		console.error(e);
	}
}

async function login() {
	const arl = arlInput.value.trim();
	if (!arl) return;
	loggingIn.value = true;
	try {
		const result = await postToServer("loginArl", { arl });
		if (!result) {
			toast(t("toasts.loginFailed"), "close", true);
			return;
		}
		switch (result.status) {
			case 1:
			case 3:
				loginStore.login({ status: result.status, user: result.user, arl });
				toast(t("toasts.loggedIn"), "done", true);
				arlInput.value = "";
				break;
			case 2:
				loginStore.setUser(result.user);
				toast(t("toasts.alreadyLogged"), "done", true);
				break;
			default:
				toast(t("toasts.loginFailed"), "close", true);
		}
	} catch {
		toast(t("toasts.loginFailed"), "close", true);
	} finally {
		loggingIn.value = false;
	}
}

async function logout() {
	await postToServer("logout");
	loginStore.logout();
	toast(t("admin.account.loggedOut"), "done", true);
}

onMounted(loadStats);
</script>

<template>
	<div class="p-6">
		<h1 class="mb-6 text-4xl">{{ t("admin.title") }}</h1>

		<!-- Stats -->
		<section class="mb-10">
			<h2 class="mb-4 text-2xl">{{ t("admin.stats.title") }}</h2>
			<div v-if="stats" class="admin-cards">
				<div class="admin-card">
					<span class="admin-card__value">{{ stats.totalDownloads }}</span>
					<span class="admin-card__label">{{
						t("admin.stats.totalDownloads")
					}}</span>
				</div>
				<div class="admin-card">
					<span class="admin-card__value">{{
						humanBytes(stats.diskUsage)
					}}</span>
					<span class="admin-card__label">{{
						t("admin.stats.diskUsage")
					}}</span>
				</div>
				<div class="admin-card">
					<span class="admin-card__value">{{ stats.perUser.length }}</span>
					<span class="admin-card__label">{{ t("admin.stats.users") }}</span>
				</div>
			</div>

			<table v-if="stats && stats.perUser.length" class="mt-6 table w-full">
				<thead>
					<tr>
						<th class="text-left">{{ t("admin.stats.user") }}</th>
						<th class="text-left">{{ t("admin.stats.downloads") }}</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="entry in stats.perUser" :key="entry.user">
						<td>{{ entry.user }}</td>
						<td>{{ entry.count }}</td>
					</tr>
				</tbody>
			</table>
			<p v-if="stats" class="mt-2 text-sm opacity-60">
				{{ t("admin.stats.downloadDir") }}: {{ stats.downloadDir }}
			</p>
		</section>

		<!-- Deezer account / ARL management -->
		<section>
			<h2 class="mb-4 text-2xl">{{ t("admin.account.title") }}</h2>
			<p class="mb-4 opacity-70">{{ t("admin.account.description") }}</p>

			<div v-if="isLoggedIn" class="mb-4 flex items-center gap-3">
				<img
					v-if="currentUser.picture"
					:src="currentUser.picture"
					class="h-12 w-12 rounded-full"
					alt="account"
				/>
				<div>
					<div class="font-semibold">{{ currentUser.name }}</div>
					<div class="text-sm opacity-60">
						{{ t("admin.account.loggedInAs") }}
					</div>
				</div>
				<button class="btn btn-primary ml-4" @click="logout">
					{{ t("admin.account.logout") }}
				</button>
			</div>
			<p v-else class="history-status--missing mb-4">
				{{ t("admin.account.notConfigured") }}
			</p>

			<div class="flex max-w-xl items-center gap-2">
				<input
					v-model="arlInput"
					type="password"
					class="arl-input"
					:placeholder="t('admin.account.arlPlaceholder')"
					@keyup.enter="login"
				/>
				<button class="btn btn-primary" :disabled="loggingIn" @click="login">
					{{ t("admin.account.save") }}
				</button>
			</div>
			<router-link
				:to="{ name: 'ARL' }"
				class="mt-2 inline-block text-sm underline opacity-70"
			>
				{{ t("admin.account.howToFindArl") }}
			</router-link>
		</section>
	</div>
</template>

<style scoped>
.admin-cards {
	display: flex;
	flex-wrap: wrap;
	gap: 1rem;
}

.admin-card {
	display: flex;
	flex-direction: column;
	background: var(--secondary-background);
	border-radius: 14px;
	padding: 1.25rem 1.5rem;
	min-width: 10rem;
}

.admin-card__value {
	font-size: 1.75rem;
	font-weight: 700;
}

.admin-card__label {
	opacity: 0.7;
	font-size: 0.9rem;
}

.arl-input {
	flex: 1;
	background: var(--secondary-background);
	color: var(--foreground);
	border: none;
	border-radius: 12px;
	padding: 8px 14px;
}

.history-status--missing {
	color: #e0a800;
}
</style>
