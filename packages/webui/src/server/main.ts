import { DeemixApp, initSharedLogin } from "@/deemixApp.js";
import { initHistoryDb } from "@/helpers/historyDb.js";
import { logger, removeOldLogs } from "@/helpers/logger.js";
import { loadLoginCredentials } from "@/helpers/loginStorage.js";
import cookieParser from "cookie-parser";
import { utils, type Listener } from "deemix";
import express, { type Express } from "express";
import session from "express-session";
import memorystore from "memorystore";
import morgan from "morgan";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import ViteExpress from "vite-express";
import { WebSocket, WebSocketServer } from "ws";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { normalizePort } from "./helpers/port.js";
import { getErrorCb, getListeningCb } from "./helpers/server-callbacks.js";
import { authMiddleware } from "./middleware/auth.js";
import { registerApis } from "./routes/api/register.js";
import indexRouter from "./routes/index.js";
import type { Arguments } from "./types.js";
import { registerWebsocket } from "./websocket/index.js";

const MemoryStore = memorystore(session);

// TODO: Remove type assertion while keeping correct types
const argv = yargs(hideBin(process.argv)).options({
	port: { type: "string", default: "6595" },
	host: { type: "string", default: "0.0.0.0" },
	locationbase: { type: "string", default: "/" },
	singleuser: { type: "boolean", default: false },
}).argv as Arguments;

const serverPort = process.env.DEEMIX_SERVER_PORT ?? argv.port;
const deemixHost = process.env.DEEMIX_HOST ?? argv.host;
const isSingleUser =
	process.env.DEEMIX_SINGLE_USER === undefined
		? !!argv.singleuser
		: process.env.DEEMIX_SINGLE_USER === "true";

const app: Express = express();

// Open (and create if needed) the download-history database early so a bad
// DEEMIX_DB_PATH surfaces at boot rather than on the first download.
initHistoryDb();

// The shared Deezer account credentials live in /config/login.json regardless of
// single-user mode, so always load them and log the shared account in below.
loadLoginCredentials();

app.set("isSingleUser", isSingleUser);

/* === Deemix App === */
const listener: Listener = {
	send: (key: string, data?: any) => {
		const logLine = utils.formatListener(key, data);
		if (logLine) logger.info(logLine);
		if (["downloadInfo", "downloadWarn"].includes(key)) return;
		wss.clients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) {
				client.send(JSON.stringify({ key, data }));
			}
		});
	},
};
const deemixApp = new DeemixApp(listener);

// Log the shared account in from the stored ARL (best-effort; admins can set or
// update the ARL later from the Admin panel).
void initSharedLogin();

/* === Middlewares === */
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
	// @ts-expect-error
	session({
		store: new MemoryStore({
			checkPeriod: 86400000, // prune expired entries every 24h
		}),
		secret: "U2hoLCBpdHMgYSBzZWNyZXQh",
		resave: true,
		saveUninitialized: true,
	})
);

if (process.env.NODE_ENV === "development") {
	app.use(morgan("dev"));
}

/* === Auth === */
// Trust proxy-injected identity headers (or fall back to a local admin in
// single-user/dev/test). Registered before every route, the static asset
// handler, and the SPA catch-all so nothing is reachable unauthenticated.
app.use(authMiddleware);

/* === Routes === */
app.use("/", indexRouter);

/* === APIs === */
registerApis(app);

/* === Config === */
app.set("port", serverPort);
app.set("deemix", deemixApp);

/* === Server port === */
const server = app.listen({
	port: normalizePort(serverPort),
	host: deemixHost,
});
const wss = new WebSocketServer({ server });

if (process.env.NODE_ENV === "production") {
	const publicPath = join(dirname(fileURLToPath(import.meta.url)), "public");
	app.use(express.static(publicPath));
	app.get("*", (_, res) => {
		res.sendFile(join(publicPath, "index.html"));
	});
} else {
	ViteExpress.bind(app, server);
}

/* === Server callbacks === */
server.on("error", getErrorCb(serverPort));
server.on("listening", getListeningCb(server));
registerWebsocket(wss, deemixApp);

/* === Remove Old logs files === */
removeOldLogs(5);

export { app, deemixApp, server };
