console.log('Background script loaded');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'API_INTERCEPTED') {
    console.log('Intercepted API:', msg.payload);
    sendResponse({ success: true });
    return false;
  }

  if (msg && msg.type === 'downloadImagesToDisk') {
    const urls = Array.isArray(msg.urls) ? msg.urls : [];

    if (!urls.length) {
      sendResponse({ success: false, message: 'No image URLs received.' });
      return false;
    }

    urls.forEach((url, index) => {
      let fileName = 'meesho/' + ('image_' + (index + 1) + '.jpg');
      try {
        const parsed = new URL(url);
        const pathname = parsed.pathname.split('/').pop();
        if (pathname && pathname.includes('.')) {
          fileName = 'meesho/' + pathname;
        }
      } catch (e) {}

      chrome.downloads.download({
        url,
        filename: fileName,
        saveAs: false
      });
    });

    sendResponse({ success: true, message: 'Queued ' + urls.length + ' image(s) for download.' });
    return false;
  }

  return false;
});
