console.log('Content script loaded');

function getUploadedImageUrls() {
	const urls = [];
	document.querySelectorAll('.MuiBox-root.css-ib7boq').forEach(container => {
		container.querySelectorAll('img').forEach(img => {
			if (img.src) urls.push(img.src);
		});
	});
	return urls;
}

async function postImagesToApi(apiUrl, expectedMinPrice) {
	const urls = getUploadedImageUrls();
	const results = [];
	for (const url of urls) {
		try {
			const res = await fetch(url);
			const blob = await res.blob();
			const form = new FormData();
			form.append('image', blob, (new URL(url)).pathname.split('/').pop());
			if (typeof expectedMinPrice === 'number' && !isNaN(expectedMinPrice)) {
				form.append('expectedMinPrice', String(expectedMinPrice));
			}
			const apiRes = await fetch(apiUrl, { method: 'POST', body: form });
			let body = null;
			try { body = await apiRes.json(); } catch(e) { body = await apiRes.text(); }
			results.push({ url, ok: apiRes.ok, status: apiRes.status, body });
		} catch (err) {
			results.push({ url, ok: false, error: String(err) });
		}
	}
	return results;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
	chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
		if (msg && msg.type === 'downloadImages') {
			const urls = getUploadedImageUrls();
			if (!urls.length) {
				sendResponse({ success: false, message: 'No images found on this page.' });
				return false;
			}

			urls.forEach((url, index) => {
				let fileName = 'image_' + (index + 1);
				try {
					const parsed = new URL(url);
					const pathname = parsed.pathname.split('/').pop();
					if (pathname && pathname.includes('.')) {
						fileName = pathname;
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

		if (msg && msg.type === 'runAnalysis') {
			(async () => {
				const apiUrl = msg.apiUrl;
				const expectedMinPrice = msg.expectedMinPrice;
				if (!apiUrl) {
					sendResponse({ success: false, message: 'No API URL provided' });
					return;
				}
				const results = await postImagesToApi(apiUrl, expectedMinPrice);
				sendResponse({ success: true, message: 'Posted ' + results.length + ' images', results });
			})();
			return true; // async
		}
	});
}
