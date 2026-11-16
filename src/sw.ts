/**
 * The service worker: lets the app start offline, while preferring the network whenever it answers.
 *
 * - Files under `assets/` have content hashes in their names, so a cached copy is never stale. They
 *   are precached at install and served from the cache.
 * - Everything else from this origin (the page itself, the manifest and the icons in `public/`) keeps
 *   its name between deploys, so it is fetched from the network first. A fresh page names the new
 *   hashed assets, which aren't precached yet and so come from the network too. Only when the
 *   network fails or is too slow does the last copy seen, or failing that the precached one, answer.
 *
 * A new version installs in the background, takes over at once and drops the old precache.
 */
import { clientsClaim } from "workbox-core";
import type { WorkboxPlugin } from "workbox-core";
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import type { PrecacheEntry } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

// The project compiles against the DOM library, so describe the service worker scope it uses here.
// The build replaces `self.__WB_MANIFEST`, written just so, with the list of files to precache.
declare const self: {
  readonly __WB_MANIFEST: (string | PrecacheEntry)[];
  readonly location: Location;
  skipWaiting(): Promise<void>;
};

const assets = new URL("assets/", self.location.href).pathname;

/** Answers from the precache when the network failed and the runtime cache has no copy. */
const precacheFallback: WorkboxPlugin = {
  handlerDidError: async ({ request }) =>
    (await matchPrecache(request.mode === "navigate" ? "index.html" : request.url)) ?? undefined,
};

// Registered before the precache route, so it wins for the files it matches.
registerRoute(
  ({ request, url }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !url.pathname.startsWith(assets),
  new NetworkFirst({
    cacheName: "trainyard-pages",
    networkTimeoutSeconds: 4,
    plugins: [precacheFallback],
  }),
);

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

void self.skipWaiting();
clientsClaim();
