/** One timer for the foreground session. A changed month/view supersedes a pending read. */
export function createRefreshScheduler(run,enabled,interval=180000,scope=()=>''){
  let timer,active=null,generation=0,lastAttempt=null,forceAfter=false;

  function pause(){clearTimeout(timer);}
  function arm(delay=interval){
    pause();
    if(enabled())timer=setTimeout(()=>refresh(),delay);
  }
  function refresh(manual=false,force=false,queueAfter=false){
    if(!enabled())return Promise.resolve();
    if(active){
      if(queueAfter)forceAfter=true;
      return active;
    }
    const remaining=lastAttempt===null?0:interval-(Date.now()-lastAttempt);
    if(!manual&&!force&&remaining>0){arm(remaining);return Promise.resolve();}
    pause();
    const startedGeneration=generation;
    let requestedScope;
    active=Promise.resolve().then(()=>{
      if(!enabled()||startedGeneration!==generation)return;
      requestedScope=scope();
      lastAttempt=Date.now();
      return run(manual);
    }).finally(()=>{
      active=null;
      const changed=startedGeneration!==generation||requestedScope!==scope();
      const again=forceAfter||changed;
      forceAfter=false;
      if(enabled()&&again)return refresh(false,true);
      arm();
    });
    return active;
  }
  function reset(){generation++;lastAttempt=null;forceAfter=false;pause();}
  return {refresh,pause,reset};
}
