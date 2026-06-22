<script setup lang="ts">
import type { DownloadState } from "@/use/download-status";
import { useI18n } from "vue-i18n";

interface Props {
	status?: DownloadState;
}

const { status = "none" } = defineProps<Props>();

const { t } = useI18n();
</script>

<template>
	<span
		v-if="status === 'downloaded'"
		class="download-indicator download-indicator--downloaded"
		:title="t('downloadIndicator.downloaded')"
		:aria-label="t('downloadIndicator.downloaded')"
	>
		<i class="material-icons">check_circle</i>
	</span>
	<span
		v-else-if="status === 'missing'"
		class="download-indicator download-indicator--missing"
		:title="t('downloadIndicator.missing')"
		:aria-label="t('downloadIndicator.missing')"
	>
		<i class="material-icons">error_outline</i>
	</span>
</template>

<style scoped>
.download-indicator {
	display: inline-flex;
	align-items: center;
	vertical-align: middle;
	margin-right: 0.35rem;
}

.download-indicator i {
	font-size: 1.15rem;
}

.download-indicator--downloaded {
	color: #1db954;
}

.download-indicator--missing {
	color: #e0a800;
}
</style>
