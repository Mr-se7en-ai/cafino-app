/* Service Worker — کافینو | CAFINO */
const VERSION = "1.77.0";
const CACHE = "cafenet-" + VERSION;
const warn = (err) => console.warn("[sw] ذخیره در کش ناموفق:", err && err.message);   // معمولاً سهمیهٔ حافظه؛ برنامه بدون کش ادامه می‌دهد
/*CHUNKS*/ const CHUNKS = ["./chunks/vendor-xlsx.0a32a8d8.js", "./chunks/vendor-xlsxworker.0c9db4b7.js", "./chunks/vendor-pdf.304e5742.js", "./chunks/vendor-pdfinfo.5a1b8a17.js", "./chunks/vendor-pdftools.d363328b.js", "./chunks/vendor-pdfjs.2058e957.js", "./chunks/vendor-pdfjsworker.ca5262e3.js"];
const CORE = [
  "./", "./index.html", "./bundle.js", "./config.js", "./manifest.webmanifest", ...CHUNKS,
  "./fonts/Vazirmatn-Regular.woff2", "./fonts/Vazirmatn-Bold.woff2", "./fonts/Vazirmatn-ExtraBold.woff2", "./fonts/Vazirmatn-Black.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-48.png"
];

// نصب «همه یا هیچ»: اگر حتی یک فایل پیش‌کش نشود، نصب شکست می‌خورد و نسخهٔ قبلی (و کش قبلی‌اش) فعال می‌ماند؛
// هرگز نسخهٔ ناقص فعال نمی‌شود. درخواست‌ها با cache:"reload" می‌روند تا فایل کهنه از کش HTTP مرورگر نیاید.
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try {
      await c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })));
    } catch (err) {
      await caches.delete(CACHE);                         // کش نیمه‌کاره نماند
      console.error("[sw] نصب ناموفق؛ نسخهٔ قبلی فعال می‌ماند:", err && err.message);
      throw err;
    }
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cafenet-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ───────── اعلان (Web Push) ─────────
// سرویس اعلان یک JSON می‌فرستد: { title, body, tag, id, url }. اگر پنجرهٔ برنامه همین الان جلوی چشم کاربر باشد،
// اعلانی نشان داده نمی‌شود (برنامه خودش هشدار درون‌برنامه‌ای دارد)؛ در غیر این صورت اعلان سیستم‌عامل نمایش داده می‌شود.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "کافینو", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "کافینو";
  const opts = {
    body: d.body || "", tag: d.tag || "cafino", lang: "fa", dir: "rtl", renotify: true, requireInteraction: true,
    icon: "./icons/icon-192.png", badge: "./icons/favicon-48.png", data: { url: d.url || "./?tab=notes", id: d.id || null },
    actions: [{ action: "open", title: "باز کردن" }],
  };
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = wins.some((c) => c.visibilityState === "visible" && c.focused !== false);
    if (visible && d.tag !== "cafino-test") { wins.forEach((c) => c.postMessage({ type: "cafino-push", id: d.id || null })); return; }
    await self.registration.showNotification(title, opts);
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./?tab=notes", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mine = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (mine) { await mine.focus(); mine.postMessage({ type: "cafino-open", tab: "notes" }); return; }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener("pushsubscriptionchange", (e) => {
  // مرورگر اشتراک را عوض کرده؛ برنامه در اولین باز شدن دوباره ثبتش می‌کند (syncPush)
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((ws) => ws.forEach((c) => c.postMessage({ type: "cafino-resubscribe" }))));
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache API/auth responses

  // config.js (تنظیم استقرار): همیشه اول شبکه تا تغییرش دیر اعمال نشود؛ آفلاین از کش
  if (url.pathname.endsWith("/config.js")) {
    e.respondWith(fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(warn); } return res; }).catch(() => caches.match(req).then((r) => r || new Response("", { headers: { "content-type": "text/javascript" } }))));
    return;
  }

  // Pages: network first (fresh), fall back to cache (offline)
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(warn);
        return res;
      }).catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(warn); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
