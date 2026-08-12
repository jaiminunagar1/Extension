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
    status.textContent = 'Preparing downloads...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, {
      type: 'downloadImages',
      expectedMinPrice
    }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = 'Could not reach the page script.';
        return;
      }

      status.textContent = response?.message || 'Download started.';
    });
  });
});
