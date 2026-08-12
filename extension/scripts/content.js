console.log('Content script loaded');

const OPTIMIZE_API_URL = 'https://wgcclfm7-8000.inc1.devtunnels.ms/images/optimize';

function getUploadedImageUrls() {
	const urls = [];
	document.querySelectorAll('.MuiBox-root.css-ib7boq').forEach(container => {
		container.querySelectorAll('img').forEach(img => {
			if (img.src) urls.push(img.src);
		});
	});
	return urls;
}

async function sendImagesToApi() {
	const urls = getUploadedImageUrls();
	const results = [];

	for (const url of urls) {
		try {
			const apiRes = await fetch(OPTIMIZE_API_URL, {
				method: 'POST',
				body: "fileuri=" + encodeURIComponent(url),
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					accept: 'application/json'
				}
			});
		

			let body = null;
			try { body = await apiRes.json(); } catch (e) { body = await apiRes.text(); }
			console.log('Optimize API response for', url, { ok: apiRes.ok, status: apiRes.status, body });
			results.push({ url, ok: apiRes.ok, status: apiRes.status, body });
		} catch (err) {
			console.error('Error sending image to optimize API for', url, err);
			results.push({ url, ok: false, error: String(err) });
		}
	}

	return results;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
	chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
		if (msg && msg.type === 'runAnalysis') {
			(async () => {
				const results = await sendImagesToApi();
				console.log('Final optimize API results:', results);
				sendResponse({
					success: true,
					message: 'Sent ' + results.length + ' image(s) to optimize API.',
					results
				});
			})();
			return true;
		}
	});
}
