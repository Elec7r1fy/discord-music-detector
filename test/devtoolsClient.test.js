import assert from "node:assert/strict";
import test from "node:test";
import { delay, evaluateInTab, navigateTab, sendDevtoolsCommand } from "../src/devtoolsClient.js";

test("sendDevtoolsCommand returns a matching CDP response", async () => {
  const result = await sendDevtoolsCommand(
    "ws://127.0.0.1/devtools/page/one",
    "Runtime.evaluate",
    { expression: "1 + 1" },
    { WebSocketImpl: FakeWebSocket }
  );

  assert.deepEqual(result, {
    result: {
      value: 2
    }
  });
  assert.equal(FakeWebSocket.last.sent.method, "Runtime.evaluate");
});

test("evaluateInTab unwraps values and browser exceptions", async () => {
  assert.equal(
    await evaluateInTab("ws://127.0.0.1/tab", "1 + 1", { WebSocketImpl: FakeWebSocket }),
    2
  );

  await assert.rejects(
    evaluateInTab("ws://127.0.0.1/tab", "throw new Error()", {
      WebSocketImpl: class extends FakeWebSocket {
        buildResult(id) {
          return {
            id,
            result: {
              exceptionDetails: {
                text: "Uncaught test error"
              }
            }
          };
        }
      }
    }),
    /Uncaught test error/
  );
});

test("navigateTab refuses non-HTTPS destinations", async () => {
  await assert.rejects(
    navigateTab("ws://127.0.0.1/tab", "http://example.com"),
    /restricted to HTTPS/
  );
});

test("sendDevtoolsCommand rejects instead of crashing when socket.send throws", async () => {
  await assert.rejects(
    sendDevtoolsCommand("ws://127.0.0.1/tab", "Runtime.evaluate", {}, {
      WebSocketImpl: class extends FakeWebSocket {
        send() {
          throw new Error("tab closed");
        }
      }
    }),
    /Could not send browser command Runtime\.evaluate: tab closed/
  );
});

test("delay rejects promptly when cancelled", async () => {
  const controller = new AbortController();
  const waiting = delay(1000, controller.signal);
  controller.abort(new Error("cancelled"));
  await assert.rejects(waiting, /cancelled/);
});

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last = null;

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.readyState = 0;
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatch("open", {});
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data) {
    this.sent = JSON.parse(data);
    const response = this.buildResult(this.sent.id);
    queueMicrotask(() => {
      this.dispatch("message", { data: JSON.stringify(response) });
    });
  }

  buildResult(id) {
    return {
      id,
      result: {
        result: {
          value: 2
        }
      }
    };
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}
