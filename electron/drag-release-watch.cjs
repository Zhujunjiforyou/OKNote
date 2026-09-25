// During a native drag the renderer can miss mouseup outside its window. Poll
// only for this drag's lifetime; the callback and its cancellation are one-shot.
function watchMouseRelease({ isPressed, onRelease, onError, interval = 32 }) {
  let timer;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  const check = () => {
    if (stopped) return;
    try {
      if (!isPressed()) {
        stop();
        onRelease();
        return;
      }
      timer = setTimeout(check, interval);
    } catch (error) {
      stop();
      onError(error);
    }
  };
  // Let the original renderer mouseup win when it is already in the IPC queue.
  timer = setTimeout(check, 120);
  return stop;
}
module.exports = { watchMouseRelease };
