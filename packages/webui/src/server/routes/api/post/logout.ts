import { Deezer } from "deezer-sdk";
import { sessionDZ } from "../../../deemixApp.js";
import { resetLoginCredentials } from "../../../helpers/loginStorage.js";
import { requireAdmin } from "../../../middleware/auth.js";
import type { ApiHandler } from "../../../types.js";

const path: ApiHandler["path"] = "/logout";

// Logs the single shared Deezer account out for everyone, so it is admin-only.
const handler: ApiHandler["handler"] = (req, res) => {
	sessionDZ[req.session.id] = new Deezer();
	resetLoginCredentials();
	res.send({ logged_out: true });
};

const apiHandler: ApiHandler = { path, handler, middleware: [requireAdmin] };

export default apiHandler;
