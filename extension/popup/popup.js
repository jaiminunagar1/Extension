document.addEventListener('DOMContentLoaded', () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const minPriceInput = document.getElementById('minPrice');
  const runButton = document.getElementById('runBtn');
  const status = document.getElementById('status');

  chrome.storage.local.get(['apiUrl', 'minPrice'], (result) => {
    if (result.apiUrl) {
      apiUrlInput.value = result.apiUrl;
    }
    if (result.minPrice) {
      minPriceInput.value = result.minPrice;
    }
  });

  runButton.addEventListener('click', async () => {
    const apiUrl = apiUrlInput.value.trim();
    const expectedMinPrice = Number(minPriceInput.value);

    if (!apiUrl) {
      status.textContent = 'Please enter an API URL.';
      return;
    }

    await chrome.storage.local.set({ apiUrl, minPrice: expectedMinPrice });
    status.textContent = 'Sending request...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, {
      type: 'runAnalysis',
      apiUrl,
      expectedMinPrice
    }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = 'Could not reach the page script.';
        return;
      }

      status.textContent = response?.message || 'Analysis finished.';
    });
  });
});
