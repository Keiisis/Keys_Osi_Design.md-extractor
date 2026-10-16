/**
 * Side panel: the panel stays open while the user browses, so it follows
 * the active tab of its window by reloading onto it. A reload never cuts a
 * running job: it waits until every request to the service worker settles.
 * popup.html?tab=<id> (detached window, E2E) stays pinned to that tab.
 */

if (!new URLSearchParams(location.search).get("tab")) {
  let inflight = 0;
  let pending = false;
  const reloadWhenIdle = () => {
    if (inflight > 0) pending = true;
    else location.reload();
  };

  const raw = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (...args) => {
    inflight += 1;
    return Promise.resolve(raw(...args)).finally(() => {
      inflight -= 1;
      if (pending && inflight === 0) location.reload();
    });
  };

  const pageKey = (url) => String(url || "").split("#")[0];
  Promise.all([chrome.windows.getCurrent(), chrome.tabs.query({ active: true, currentWindow: true })]).then(([win, [tab]]) => {
    const followed = { id: tab?.id, url: pageKey(tab?.url) };
    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
      if (windowId === win.id && tabId !== followed.id) reloadWhenIdle();
    });
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (tabId === followed.id && change.url && pageKey(change.url) !== followed.url) reloadWhenIdle();
    });
  });
}
