/* ORVYN service worker: offline shell, web push with actions, dismiss-everywhere. */
const SHELL = 'orvyn-shell-v1';
const STATIC = 'orvyn-static-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/sign-in']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![SHELL, STATIC].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // never cache API calls
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches
        .open(STATIC)
        .then(
          async (c) =>
            (await c.match(e.request)) || fetch(e.request).then((r) => (c.put(e.request, r.clone()), r)),
        ),
    );
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(async () => (await caches.match(e.request)) || caches.match('/')));
  }
});

self.addEventListener('push', (e) => {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch {
    return;
  }
  if (p.type === 'dismiss' || p.type === 'read') {
    e.waitUntil(self.registration.getNotifications({ tag: p.id }).then((ns) => ns.forEach((n) => n.close())));
    return;
  }
  e.waitUntil(
    self.registration.showNotification(p.title || 'ORVYN', {
      body: p.body || '',
      tag: p.id,
      renotify: p.priority === 'urgent' || p.priority === 'high',
      icon: '/icons/192',
      badge: '/icons/96',
      data: { id: p.id, url: p.url || '/', actions: p.actions || [] },
      actions: (p.actions || []).slice(0, 2).map((a) => ({ action: a.id, title: a.label })),
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const action = (d.actions || []).find((a) => a.id === e.action);
  const target = new URL((action && action.open) || d.url || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(target).then((w) => w && w.focus());
      return self.clients.openWindow(target);
    }),
  );
});
