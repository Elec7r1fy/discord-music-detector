const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};

export function createLogger(level = "info") {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(method, message) {
    if ((LEVELS[method] ?? LEVELS.info) < threshold) {
      return;
    }

    const timestamp = new Date().toISOString();
    console[method === "debug" ? "log" : method](`[${timestamp}] ${message}`);
  }

  return {
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message)
  };
}
