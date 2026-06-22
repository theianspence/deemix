import { type ApiHandler } from "../../../types.js";
import deleteHistory from "./deleteHistory.js";
import deleteLibrary from "./deleteLibrary.js";

export default [deleteHistory, deleteLibrary] as ApiHandler[];
