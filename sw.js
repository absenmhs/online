const prefix='mhs:'+new URL(self.registration.scope).pathname+':';
const cacheName=prefix+'pilot-2.5.12-hf12-precheck-pattern-audit';
const files=['./','./index.html','./manifest.webmanifest','./css/app.css','./js/config.js','./js/app.js','./js/ui.js','./js/views200.js','./assets/favicon.png','./js/capture.js','./js/office-map.js','./js/liveness.js','./js/daily.js','./js/photo.js','./js/refresh.js','./js/api.js','./js/store.js','./js/icons.js','./assets/brand.png','./assets/avatar.webp','./assets/mentaya.webp','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(files.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(prefix)&&k!==cacheName).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(self.registration.scope))return;
  const relative='./'+url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if(req.mode!=='navigate'&&!files.includes(relative))return;
  event.respondWith((async()=>{
    const cache=await caches.open(cacheName),key=req.mode==='navigate'?'./index.html':relative;
    const stored=await cache.match(key);
    if(stored)return stored;
    try{return await fetch(req)}
    catch{return Response.error()}
  })());
});
