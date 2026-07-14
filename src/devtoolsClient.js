export async function sendDevtoolsCommand(
  webSocketUrl,
  method,
  params = {},
  { timeoutMs = 3000, WebSocketImpl = globalThis.WebSocket } = {}
) {
  if (typeof WebSocketImpl !== "function") {
    throw new Error("Browser control requires Node.js 22 or another runtime with WebSocket support.");
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(webSocketUrl);
    const id = 1;
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for browser command ${method}.`));
    }, timeoutMs);

    const finish = (error, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Ignore cleanup failures from an already-closed debugger socket.
      }

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    socket.addEventListener("open", () => {
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        finish(new Error(`Could not send browser command ${method}: ${error.message}`));
      }
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.id !== id) {
        return;
      }

      if (message.error) {
        finish(new Error(message.error.message ?? `Browser command ${method} failed.`));
      } else {
        finish(null, message.result ?? {});
      }
    });

    socket.addEventListener("error", () => {
      finish(new Error(`Browser debugger connection failed during ${method}.`));
    });

    socket.addEventListener("close", () => {
      if (!settled) {
        finish(new Error(`Browser debugger closed during ${method}.`));
      }
    });
  });
}

export async function evaluateInTab(webSocketUrl, expression, options = {}) {
  const result = await sendDevtoolsCommand(
    webSocketUrl,
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    options
  );

  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.text
      ?? "Browser evaluation failed.";
    throw new Error(description);
  }

  return result.result?.value;
}

export async function navigateTab(webSocketUrl, url, options = {}) {
  const destination = new URL(url);
  if (destination.protocol !== "https:") {
    throw new Error("Browser navigation is restricted to HTTPS URLs.");
  }

  return sendDevtoolsCommand(
    webSocketUrl,
    "Page.navigate",
    { url: destination.href },
    options
  );
}

export function delay(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Operation was cancelled."));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error("Operation was cancelled."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
