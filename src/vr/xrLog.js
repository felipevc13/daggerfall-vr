// Remote Telemetry & Error Logger for Meta Quest Standalone VR
// Streams console logs, WebXR events, and runtime errors to the host machine via /api/vr-log.

(function initRemoteLogger() {
  if (window.__vrLoggerInstalled) return;
  window.__vrLoggerInstalled = true;

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  const logQueue = [];
  let isSending = false;

  async function flushLogs() {
    if (isSending || logQueue.length === 0) return;
    isSending = true;
    const batch = logQueue.splice(0, 10);
    try {
      for (const item of batch) {
        await fetch('/api/vr-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
      }
    } catch (_) {
      // Put back if network hiccup
      logQueue.unshift(...batch);
    } finally {
      isSending = false;
      if (logQueue.length > 0) setTimeout(flushLogs, 50);
    }
  }

  function formatArg(a) {
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
      } catch (_) {
        return String(a);
      }
    }
    return String(a);
  }

  function queue(level, args) {
    const message = args.map(formatArg).join(' ');
    logQueue.push({
      level,
      message,
      timestamp: Date.now(),
    });
    flushLogs();
  }

  console.log = function (...args) {
    origLog.apply(console, args);
    queue('info', args);
  };

  console.warn = function (...args) {
    origWarn.apply(console, args);
    queue('warn', args);
  };

  console.error = function (...args) {
    origError.apply(console, args);
    queue('error', args);
  };

  window.addEventListener('error', (event) => {
    queue('error', [`[WINDOW ERROR] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`, event.error]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    queue('error', ['[UNHANDLED PROMISE REJECTION]', event.reason]);
  });

  // Client Hello
  queue('info', [
    '🚀 [QUEST VR ATTACHED]',
    `UA: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}x${window.innerHeight}`,
    `WebXR Available: ${'xr' in navigator}`,
  ]);
})();
