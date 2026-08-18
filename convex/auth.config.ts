import type { AuthConfig } from "convex/server";

/** Convex Auth validates its own JWT issuer on the deployment's site domain. */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;

