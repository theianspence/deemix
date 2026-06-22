import http from "http";
import { logger } from "./logger.js";

/**
 * Event listener for HTTP server "error" event.
 *
 * @since	0.0.0
 */
export function getErrorCb(port: number | string | boolean) {
	return (error: any) => {
		if (error.syscall !== "listen") {
			throw error;
		}

		const bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

		// During tests, every endpoint suite imports the app and tries to listen on
		// the same port; the resulting EADDRINUSE is harmless (supertest drives the
		// Express app object directly) and must NOT exit the worker.
		if (process.env.NODE_ENV === "test") {
			logger.warn(`${bind} unavailable in test (${error.code}); continuing`);
			return;
		}

		// handle specific listen errors with friendly messages
		switch (error.code) {
			case "EACCES":
				logger.error(bind + " requires elevated privileges");
				process.exit(1);
				break;
			case "EADDRINUSE":
				logger.error(bind + " is already in use");
				process.exit(1);
				break;
			default:
				throw error;
		}
	};
}

/**
 * Event listener for HTTP server "listening" event.
 *
 * @since	0.0.0
 */
export function getListeningCb(server: http.Server) {
	return () => {
		const addr = server.address();

		if (addr) {
			const ip = typeof addr === "string" ? "pipe " + addr : addr.address;
			const port = typeof addr === "string" ? "pipe " + addr : addr.port;

			logger.info(`Listening on ${ip}:${port}`);
		}
	};
}
