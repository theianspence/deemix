import fs from "fs";
import { join } from "path";

interface SizeCache {
	path: string;
	bytes: number;
	at: number;
}

let cache: SizeCache | null = null;
const TTL_MS = 60_000;

/**
 * Recursively sum the size of every file under `dir`. Result is cached for 60s
 * per directory so the admin stats endpoint doesn't re-walk a large library on
 * every request. Unreadable entries are skipped rather than throwing.
 */
export function getDirectorySize(dir: string): number {
	if (cache && cache.path === dir && Date.now() - cache.at < TTL_MS) {
		return cache.bytes;
	}

	let total = 0;
	const walk = (current: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			try {
				if (entry.isDirectory()) {
					walk(full);
				} else if (entry.isFile()) {
					total += fs.statSync(full).size;
				}
			} catch {
				// Ignore files that vanish or can't be stat'd mid-walk.
			}
		}
	};

	if (fs.existsSync(dir)) walk(dir);

	cache = { path: dir, bytes: total, at: Date.now() };
	return total;
}
