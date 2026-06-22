import { authMiddleware, requireAdmin } from "./auth.js";

function mockReqRes(headers: Record<string, string> = {}) {
	const req = {
		header: (name: string) => headers[name.toLowerCase()],
	} as any;
	const res = {
		statusCode: 200,
		body: undefined as any,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		send(payload: any) {
			this.body = payload;
			return this;
		},
	} as any;
	return { req, res };
}

describe("authMiddleware", () => {
	const original = {
		NODE_ENV: process.env.NODE_ENV,
		DEEMIX_SINGLE_USER: process.env.DEEMIX_SINGLE_USER,
	};

	beforeEach(() => {
		// Disable the test/single-user bypass so the header path is exercised.
		process.env.NODE_ENV = "production";
		delete process.env.DEEMIX_SINGLE_USER;
		delete process.env.AUTH_USER_HEADER;
		delete process.env.AUTH_GROUP_HEADER;
		delete process.env.AUTH_NAME_HEADER;
		delete process.env.ADMIN_GROUP;
		delete process.env.TRACK_DOWNLOAD_GROUP;
		delete process.env.PLAYLIST_DOWNLOAD_GROUP;
	});

	afterEach(() => {
		process.env.NODE_ENV = original.NODE_ENV;
		if (original.DEEMIX_SINGLE_USER === undefined)
			delete process.env.DEEMIX_SINGLE_USER;
		else process.env.DEEMIX_SINGLE_USER = original.DEEMIX_SINGLE_USER;
	});

	test("returns 401 when the user header is absent", () => {
		const { req, res } = mockReqRes();
		let nextCalled = false;
		authMiddleware(req, res, () => {
			nextCalled = true;
		});
		expect(res.statusCode).toBe(401);
		expect(nextCalled).toBe(false);
		expect(req.user).toBeUndefined();
	});

	test("attaches user with admin flag from groups", () => {
		const { req, res } = mockReqRes({
			"remote-user": "alice",
			"remote-groups": "users, admins",
			"remote-name": "Alice A",
		});
		let nextCalled = false;
		authMiddleware(req, res, () => {
			nextCalled = true;
		});
		expect(nextCalled).toBe(true);
		expect(req.user.username).toBe("alice");
		expect(req.user.name).toBe("Alice A");
		expect(req.user.isAdmin).toBe(true);
	});

	test("standard user is not admin", () => {
		const { req, res } = mockReqRes({
			"remote-user": "bob",
			"remote-groups": "users",
		});
		authMiddleware(req, res, () => {});
		expect(req.user.isAdmin).toBe(false);
		expect(req.user.name).toBe("bob"); // falls back to username
	});

	test("admins may download tracks and playlists", () => {
		const { req, res } = mockReqRes({
			"remote-user": "alice",
			"remote-groups": "admins",
		});
		authMiddleware(req, res, () => {});
		expect(req.user.canDownloadTracks).toBe(true);
		expect(req.user.canDownloadPlaylists).toBe(true);
	});

	test("standard users default to albums only", () => {
		const { req, res } = mockReqRes({
			"remote-user": "bob",
			"remote-groups": "users",
		});
		authMiddleware(req, res, () => {});
		expect(req.user.canDownloadTracks).toBe(false);
		expect(req.user.canDownloadPlaylists).toBe(false);
	});

	test("configured groups grant per-type download permission", () => {
		process.env.TRACK_DOWNLOAD_GROUP = "dj";
		const { req, res } = mockReqRes({
			"remote-user": "bob",
			"remote-groups": "users, dj",
		});
		authMiddleware(req, res, () => {});
		expect(req.user.canDownloadTracks).toBe(true);
		expect(req.user.canDownloadPlaylists).toBe(false); // no playlist group
	});

	test("single-user bypass injects a local admin", () => {
		process.env.DEEMIX_SINGLE_USER = "true";
		const { req, res } = mockReqRes();
		let nextCalled = false;
		authMiddleware(req, res, () => {
			nextCalled = true;
		});
		expect(nextCalled).toBe(true);
		expect(req.user.isAdmin).toBe(true);
	});
});

describe("requireAdmin", () => {
	test("rejects non-admins with 403", () => {
		const req = { user: { isAdmin: false } } as any;
		const res = {
			statusCode: 200,
			status(code: number) {
				this.statusCode = code;
				return this;
			},
			send() {
				return this;
			},
		} as any;
		let nextCalled = false;
		requireAdmin(req, res, () => {
			nextCalled = true;
		});
		expect(res.statusCode).toBe(403);
		expect(nextCalled).toBe(false);
	});

	test("allows admins through", () => {
		const req = { user: { isAdmin: true } } as any;
		const res = { status: () => res, send: () => res } as any;
		let nextCalled = false;
		requireAdmin(req, res, () => {
			nextCalled = true;
		});
		expect(nextCalled).toBe(true);
	});
});
