const port = chrome.runtime.connect({ name: "keepalive" });
setInterval(() => port.postMessage({ type: "ping" }), 20000);
