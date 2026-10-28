(() => {
  const SOURCE = "fairway-vero-proof-capture";

  function maybePost(url, body) {
    try {
      const u = new URL(String(url), window.location.href);
      if (
        u.hostname === "asiointi.positiivinenluottotietorekisteri.fi" &&
        u.pathname.includes("/loans")
      ) {
        window.postMessage(
          {
            source: SOURCE,
            payload: {
              url: u.toString(),
              pageUrl: window.location.href,
              body,
              capturedAt: Date.now(),
            },
          },
          "*"
        );
      }
    } catch {
      // Ignore non-URL request inputs.
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
      response
        .clone()
        .json()
        .then((body) => maybePost(requestUrl, body))
        .catch(() => {});
    } catch {
      // Leave the page behavior untouched.
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.__fairwayVeroUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function send(...args) {
    this.addEventListener("load", () => {
      try {
        const body = JSON.parse(this.responseText);
        maybePost(this.__fairwayVeroUrl, body);
      } catch {
        // Non-JSON response.
      }
    });
    return originalSend.apply(this, args);
  };
})();
