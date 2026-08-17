document.addEventListener('DOMContentLoaded', () => {
  const minPriceInput = document.getElementById('minPrice');
  const runButton = document.getElementById('runBtn');
  const status = document.getElementById('status');
  const resultBox = document.getElementById('resultBox');
  const resultImage = document.getElementById('resultImage');
  const resultDetails = document.getElementById('resultDetails');
  const downloadBtn = document.getElementById('downloadBtn');

  const renderResult = (bestImage) => {
    if (!bestImage) {
      resultBox.classList.add('hidden');
      return;
    }

    resultImage.src = bestImage.previewUrl || bestImage.downloadUrl || bestImage.uploadedImageUrl;
    resultImage.alt = bestImage.filename || 'Best generated image';
    resultDetails.innerHTML = `
      <p><strong>Shipping Charge:</strong> ₹${Number(bestImage.shippingCharge).toFixed(0)}</p>
      ${bestImage.duplicatePid != null ? `<p><strong>Duplicate PID:</strong> ${bestImage.duplicatePid}</p>` : ''}
      ${bestImage.uploadedImageUrl ? `<p><strong>Uploaded Image:</strong> ${bestImage.uploadedImageUrl}</p>` : ''}
    `;

    downloadBtn.onclick = () => {
      const downloadUrl = bestImage.downloadUrl || bestImage.previewUrl || bestImage.uploadedImageUrl;
      if (!downloadUrl) {
        return;
      }

      chrome.runtime.sendMessage({
        type: 'downloadImagesToDisk',
        urls: [downloadUrl],
        filename: bestImage.downloadName || bestImage.filename || 'best-image.jpg'
      });
    };

    resultBox.classList.remove('hidden');
  };

  chrome.storage.local.get(['minPrice'], (result) => {
    if (typeof result.minPrice === 'number' && !isNaN(result.minPrice)) {
      minPriceInput.value = result.minPrice;
    }
  });

  runButton.addEventListener('click', async () => {
    const expectedMinPrice = Number(minPriceInput.value);

    await chrome.storage.local.set({ minPrice: expectedMinPrice });
    status.textContent = 'Generating and comparing Meesho image options...';
    resultBox.classList.add('hidden');

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

      status.textContent = response?.message || 'Image analysis complete.';
      renderResult(response?.bestImage || null);
    });
  });
});
