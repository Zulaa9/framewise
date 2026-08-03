// Service worker: solo se encarga del badge del icono (velocidad actual por pestaña).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "speedChanged" && sender.tab) {
    const label = Math.abs(msg.speed - 1) < 0.001 ? "" : formatBadge(msg.speed);
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: label });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#3a91d2" });
  }
});

function formatBadge(speed) {
  let s = speed.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return s + "x";
}

// Limpia el badge cada vez que la pestaña navega a una página nueva.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});
