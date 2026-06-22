import type { RequestHandler } from "express";

/**
 * Identity attached to every request once the proxy-header auth middleware has
 * run. Populated from the headers injected by an upstream reverse proxy
 * (Authentik / Authelia / Traefik Forward Auth / Caddy, ...).
 */
export interface AuthUser {
	username: string;
	groups: string[];
	name: string;
	isAdmin: boolean;
}

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			user?: AuthUser;
		}
	}
}

export interface AuthConfig {
	userHeader: string;
	groupHeader: string;
	nameHeader: string;
	adminGroup: string;
}

/** Read the configurable header names / admin group from the environment. */
export function getAuthConfig(): AuthConfig {
	return {
		userHeader: process.env.AUTH_USER_HEADER || "Remote-User",
		groupHeader: process.env.AUTH_GROUP_HEADER || "Remote-Groups",
		nameHeader: process.env.AUTH_NAME_HEADER || "Remote-Name",
		adminGroup: process.env.ADMIN_GROUP || "admins",
	};
}

/**
 * When running without a proxy in front (local `pnpm dev`, single-user mode, or
 * the test suite) we cannot read identity headers, so we fall back to a local
 * admin. In production (DEEMIX_SINGLE_USER=false) the proxy is mandatory and a
 * missing user header is a hard 401.
 */
function isAuthBypassed(): boolean {
	return (
		process.env.NODE_ENV === "test" || process.env.DEEMIX_SINGLE_USER === "true"
	);
}

function parseGroups(raw: string | undefined): string[] {
	if (!raw) return [];
	// Proxies disagree on the separator: Authelia/Traefik use commas, Authentik
	// uses pipes, some use newlines. Accept all of them.
	return raw
		.split(/[,|\n]/)
		.map((group) => group.trim())
		.filter(Boolean);
}

/**
 * Trust the proxy-injected headers and attach `req.user`. Returns 401 when the
 * username header is absent and auth is not bypassed — the app must never be
 * reachable without an authenticated identity in production.
 */
export const authMiddleware: RequestHandler = (req, res, next) => {
	const config = getAuthConfig();

	if (isAuthBypassed()) {
		const username = process.env.DEEMIX_SINGLE_USER_NAME || "admin";
		req.user = {
			username,
			groups: [config.adminGroup],
			name: username,
			isAdmin: true,
		};
		next();
		return;
	}

	// Express header lookups are case-insensitive.
	const username = req.header(config.userHeader);
	if (!username) {
		res
			.status(401)
			.send({
				error: "Unauthorized",
				message: "Missing authentication header",
			});
		return;
	}

	const groups = parseGroups(req.header(config.groupHeader));

	req.user = {
		username,
		groups,
		name: req.header(config.nameHeader) || username,
		isAdmin: groups.includes(config.adminGroup),
	};

	next();
};

/** Gate a route to admins (members of the configured ADMIN_GROUP) only. */
export const requireAdmin: RequestHandler = (req, res, next) => {
	if (req.user?.isAdmin) {
		next();
		return;
	}
	res
		.status(403)
		.send({ error: "Forbidden", message: "Admin access required" });
};
