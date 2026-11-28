/** HF14: map for the capture screen only. Office center always comes from
 * CAPTURE_INFO (Google Sheet -> backend); no LOC coordinates hardcoded here.
 * The two markers are visual aids, never security evidence. */
const TILE=256;
const WEBMERCATOR_MAX=85.05112878;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function world(lat,lon,zoom){
  const phi=clamp(lat,-WEBMERCATOR_MAX,WEBMERCATOR_MAX)*Math.PI/180;
  const scale=TILE*2**zoom;
  return {x:(lon+180)/360*scale,
    y:(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2*scale};
}
function validPoint(o){return o&&Number.isFinite(o.lat)&&Number.isFinite(o.lon)&&
  Math.abs(o.lat)<=90&&Math.abs(o.lon)<=180;}
function htmlMarker(className,at,title){
  const pin=document.createElement('span');pin.className='hf14-map-pin '+className;
  pin.style.left=at.x+'px';pin.style.top=at.y+'px';
  pin.setAttribute('role','img');pin.setAttribute('aria-label',title);pin.title=title;
  return pin;
}
export function drawCaptureOfficeMap(map,office,gps){
  if(!map||!validPoint(office))return;
  const device=gps&&Number.isFinite(gps.latitude)&&Number.isFinite(gps.longitude)&&
    Math.abs(gps.latitude)<=90&&Math.abs(gps.longitude)<=180?
    {lat:gps.latitude,lon:gps.longitude}:null;
  const width=Math.max(220,Math.round(map.clientWidth||360));
  const height=Math.max(170,Math.round(map.clientHeight||300));
  const key=[office.id,office.lat.toFixed(7),office.lon.toFixed(7),office.radius,
    device?.lat.toFixed(5),device?.lon.toFixed(5),width,height].join('|');
  if(map._hf14Key===key)return;
  map._hf14Key=key;
  let zoom=17,center,target,position,metersPerPixel;
  for(let z=19;z>=4;z--){
    target=world(office.lat,office.lon,z);
    position=device?world(device.lat,device.lon,z):target;
    center={x:(target.x+position.x)/2,y:(target.y+position.y)/2};
    metersPerPixel=40075016.686*Math.cos(office.lat*Math.PI/180)/(TILE*2**z);
    const radiusPixels=office.radius/metersPerPixel;
    const xSpan=Math.abs(target.x-position.x)+2*radiusPixels;
    const ySpan=Math.abs(target.y-position.y)+2*radiusPixels;
    if(xSpan<=width-70&&ySpan<=height-65){zoom=z;break;}
    zoom=z;
  }
  const scale=TILE*2**zoom;
  const topLeft={x:center.x-width/2,y:center.y-height/2};
  const tiles=document.createElement('div');tiles.className='hf14-tile-layer';
  const minX=Math.floor(topLeft.x/TILE),maxX=Math.floor((topLeft.x+width)/TILE),
    minY=Math.floor(topLeft.y/TILE),maxY=Math.floor((topLeft.y+height)/TILE);
  for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
    if(y<0||y>=2**zoom)continue;
    const tile=document.createElement('img');tile.alt='';tile.loading='lazy';
    tile.decoding='async';tile.width=TILE;tile.height=TILE;
    const normalizedX=((x%(2**zoom))+(2**zoom))%(2**zoom);
    tile.src=`https://tile.openstreetmap.org/${zoom}/${normalizedX}/${y}.png`;
    tile.style.left=Math.round(x*TILE-topLeft.x)+'px';
    tile.style.top=Math.round(y*TILE-topLeft.y)+'px';
    tiles.appendChild(tile);
  }
  const overlay=document.createElement('div');overlay.className='hf14-map-overlays';
  const targetPx={x:target.x-topLeft.x,y:target.y-topLeft.y};
  const radiusPx=Math.max(1,Math.round(office.radius/metersPerPixel));
  const radius=document.createElement('span');radius.className='hf14-map-radius';
  radius.style.left=targetPx.x+'px';radius.style.top=targetPx.y+'px';
  radius.style.width=(radiusPx*2)+'px';radius.style.height=(radiusPx*2)+'px';
  overlay.appendChild(radius);
  overlay.appendChild(htmlMarker('hf14-map-office',targetPx,'Pusat lokasi presensi'));
  if(device){
    const exact={x:position.x-topLeft.x,y:position.y-topLeft.y};
    const overlap=Math.hypot(exact.x-targetPx.x,exact.y-targetPx.y)<27;
    // Keep the true center at the office marker. When two pins overlap,
    // visually offset the blue pin with a leader, not the GPS coordinates.
    const shown=overlap?{x:exact.x+23,y:exact.y-23}:exact;
    if(overlap){
      const leader=document.createElement('span');leader.className='hf14-pin-leader';
      leader.style.left=exact.x+'px';leader.style.top=exact.y+'px';
      leader.style.width=Math.hypot(shown.x-exact.x,shown.y-exact.y)+'px';
      leader.style.transform='rotate(-45deg)';overlay.appendChild(leader);
    }
    overlay.appendChild(htmlMarker('hf14-map-device',shown,
      overlap?'Lokasi perangkat dekat pusat kantor. Penanda digeser agar terlihat.':'Lokasi perangkat saat ini'));
  }
  const attribution=document.createElement('a');
  attribution.className='hf14-map-attribution';
  attribution.href='https://www.openstreetmap.org/copyright';
  attribution.target='_blank';attribution.rel='noopener noreferrer';
  attribution.textContent='© OpenStreetMap';
  map.replaceChildren(tiles,overlay,attribution);
}
