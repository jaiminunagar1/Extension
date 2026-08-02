document.getElementById('changeColorBtn').addEventListener('click', async () => {
  // Get the active tab in the current window
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Execute a script on that tab to change its background color
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: setBackgroundColor,
  });
});

// Function injected into the page
function setBackgroundColor() {
  document.body.style.backgroundColor = 'salmon';
}