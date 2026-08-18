import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth's HTTP routes handle password sign-up/sign-in and token
// refreshes for both web and native clients.
auth.addHttpRoutes(http);

export default http;
