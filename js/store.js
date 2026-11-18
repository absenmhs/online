let opening;
function db(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    const req=indexedDB.open('absen-mhs-pilot-'+new URL('.',document.baseURI).pathname,2);
    req.onupgradeneeded=()=>{
      for(const [name,key] of [['queue','id'],['status','owner'],['drafts','id'],['photos','owner']])
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name,{keyPath:key});
    };
    req.onsuccess=()=>{
      req.result.onversionchange=()=>{req.result.close();opening=null};
      resolve(req.result);
    };
    req.onblocked=()=>{opening=null;reject(Error('Tutup tab PWA lain, lalu muat ulang untuk memperbarui penyimpanan.'))};
    req.onerror=()=>{opening=null;reject(req.error)};
  });
  return opening;
}
async function tx(name,mode,operation){
  const database=await db();
  return new Promise((resolve,reject)=>{
    const transaction=database.transaction(name,mode), request=operation(transaction.objectStore(name));
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onabort=()=>reject(transaction.error||Error('Penyimpanan perangkat gagal.'));
    transaction.onerror=()=>reject(transaction.error);
  });
}
export const put=(name,row)=>tx(name,'readwrite',s=>s.put(row));
export const remove=(name,key)=>tx(name,'readwrite',s=>s.delete(key));
export const get=(name,key)=>tx(name,'readonly',s=>s.get(key));
export async function owned(name,owner){
  return (await tx(name,'readonly',s=>s.getAll())).filter(r=>r.owner===owner).sort((a,b)=>a.at-b.at);
}
