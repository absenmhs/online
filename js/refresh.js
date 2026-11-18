/** One scheduler per page. Foreground events are coalesced; failures wait 180 seconds. */
export function createRefreshScheduler(run, enabled, interval = 180000) {
  let timer = null;
  let active = null;
  let generation = 0;
  let lastAttempt = 0;
  let rerun = false;

  function clearTimer() {
    clearTimeout(timer);
    timer = null;
  }
  function arm() {
    clearTimer();
    if (enabled()) timer = setTimeout(() => refresh(), interval);
  }
  function refresh(manual = false, force = false, queueAfter = false) {
    if (!enabled()) return Promise.resolve();
    if (active) {
      // A changed period or newly queued transaction must get its own next read.
      if (queueAfter) rerun = true;
      return active;
    }
    if (!manual && !force && Date.now() - lastAttempt < interval) {
      clearTimer();
      timer = setTimeout(() => refresh(), interval - (Date.now() - lastAttempt));
      return Promise.resolve();
    }
    clearTimer();
    lastAttempt = Date.now();
    const startedGeneration = generation;
    active = Promise.resolve().then(() => run(manual)).finally(() => {
      active = null;
      if (startedGeneration !== generation) {
        if (rerun) { rerun = false; refresh(false, true); }
        return;
      }
      if (rerun) { rerun = false; refresh(false, true); }
      else arm();
    });
    return active;
  }
  function pause() { clearTimer(); }
  function reset() {
    generation++;
    lastAttempt = 0;
    rerun = false;
    clearTimer();
  }
  return {refresh, pause, reset};
}
