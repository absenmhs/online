// A small, north-up OSM viewport. Request visible tiles only.
const rad=Math.PI/180,earth=6371008.8;
export function distanceTo(office,fix){
  const dlat=(fix.latitude-office.lat)*rad,dlon=(fix.longitude-office.lon)*rad;
  return 2*earth*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+
    Math.cos(office.lat*rad)*Math.cos(fix.latitude*rad)*Math.sin(dlon/2)**2)));
}
function point(lat,lon,size){
  const s=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*rad);
  return {x:(lon+180)/360*size,y:(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*size};
}
export function drawOfficeMap(box,office,fix){
  const w=box.clientWidth||300,h=box.clientHeight||160;
  const distance=fix?distanceTo(office,fix):0,span=Math.max(office.radius, distance+(fix?.gpsAccuracy||0),30);
  const zoom=Math.max(1,Math.min(19,Math.floor(Math.log2(156543.03*Math.cos(office.lat*rad)*Math.min(w,h)*0.43/span))));
  const size=256*2**zoom,center=point(office.lat,office.lon,size);
  const ox=center.x-w/2,oy=center.y-h/2,mpp=156543.03*Math.cos(office.lat*rad)/2**zoom;
  const key=[w,h,zoom,office.id,ox,oy].join('|');
  if(box.dataset.tiles!==key){
    box.replaceChildren();box.dataset.tiles=key;
    for(let y=Math.floor(oy/256);y<=Math.floor((oy+h-1)/256);y++){
      if(y<0||y>=2**zoom)continue;
      for(let x=Math.floor(ox/256);x<=Math.floor((ox+w-1)/256);x++){
        const img=document.createElement('img');img.alt='';img.width=img.height=256;
        img.style.left=(x*256-ox)+'px';img.style.top=(y*256-oy)+'px';
        img.referrerPolicy='strict-origin-when-cross-origin';
        img.src='https://tile.openstreetmap.org/'+zoom+'/'+((x+2**zoom)%2**zoom)+'/'+y+'.png';
        img.onerror=()=>{img.hidden=true;box.querySelector('.map-unavailable')?.removeAttribute('hidden');};
        box.append(img);
      }
    }
    box.insertAdjacentHTML('beforeend','<span class="office-radius"></span><i class="office-dot" title="Kantor"></i><i class="device-dot" title="Perangkat" hidden></i><small class="map-unavailable" hidden>Peta jalan belum termuat</small><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>');
    const ring=box.querySelector('.office-radius');ring.style.width=ring.style.height=2*office.radius/mpp+'px';
  }
  const marker=box.querySelector('.device-dot');
  marker.hidden=!fix;
  if(fix){const p=point(fix.latitude,fix.longitude,size);marker.style.left=(p.x-ox)+'px';marker.style.top=(p.y-oy)+'px';}
}
