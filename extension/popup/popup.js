document.addEventListener('DOMContentLoaded', () => {
  const minPriceInput = document.getElementById('minPrice');
  const runButton = document.getElementById('runBtn');
  const status = document.getElementById('status');

  chrome.storage.local.get(['minPrice'], (result) => {
    if (typeof result.minPrice === 'number' && !isNaN(result.minPrice)) {
      minPriceInput.value = result.minPrice;
    }
  });

  runButton.addEventListener('click', async () => {
    const expectedMinPrice = Number(minPriceInput.value);

    await chrome.storage.local.set({ minPrice: expectedMinPrice });
    status.textContent = 'Sending image to API...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      status.textContent = 'No active tab found.';
      return;
    }

    const tabUrl = tab.url || '';
    const isSupportedTab = tabUrl.includes('supplier.meesho.com/panel/v3/new/cataloging/');

    if (!isSupportedTab) {
      status.textContent = 'Open a Meesho catalog page first.';
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      type: 'runAnalysis',
      expectedMinPrice
    }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = 'Could not reach the page script. Reload the extension and reopen the Meesho page.';
        return;
      }

      status.textContent = response?.message || 'Image sent.';
    });
  });
});
