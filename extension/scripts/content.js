console.log('Content script loaded');

let currentSubSubCategoryId = null;

window.addEventListener('message', (event) => {
  if (event.source !== window) {
    return;
  }

  if (event.data && event.data.source === 'MY_EXTENSION' && event.data.type === 'API_INTERCEPTED') {
    const payload = event.data.payload || {};
    const nextCategoryId = payload.sub_sub_category_id ?? payload?.requestBody?.sub_sub_category_id ?? null;

    if (nextCategoryId != null) {
      currentSubSubCategoryId = nextCategoryId;
      window.__MEESHO_SUB_SUB_CATEGORY_ID__ = nextCategoryId;
    }

    try {
      chrome.runtime.sendMessage({
        type: 'API_INTERCEPTED',
        payload
      });
    } catch (error) {
      console.warn('Failed to forward intercepted API data to background.', error);
    }
  }
});

const OPTIMIZE_API_URL = 'https://wgcclfm7-8000.inc1.devtunnels.ms/images/optimize';
const UPLOAD_API_URL = 'https://supplier.meesho.com/api/cataloging/singleCatalogUpload/uploadSingleCatalogImages';
const SHIPPING_API_URL = 'https://supplier.meesho.com/api/cataloging/priceRecommendation/fetchDuplicatePid';

function getCurrentSubSubCategoryId() {
  const directValue = window.__MEESHO_SUB_SUB_CATEGORY_ID__ ?? currentSubSubCategoryId;
  if (directValue == null || directValue === '') {
    return null;
  }

  const numericValue = Number(directValue);
  return Number.isFinite(numericValue) ? numericValue : directValue;
}

function getUploadedImageUrls() {
  const urls = [];
  document.querySelectorAll('.MuiBox-root.css-ib7boq').forEach((container) => {
    container.querySelectorAll('img').forEach((img) => {
      if (img.src) {
        urls.push(img.src);
      }
    });
  });

  return urls;
}

function getMimeFromDataUri(dataUri) {
  if (!dataUri || typeof dataUri !== 'string') {
    return null;
  }

  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  return match ? match[1] : null;
}

function dataUriToBlob(dataUri, mimeType) {
  if (!dataUri || typeof dataUri !== 'string') {
    return null;
  }

  const normalizedMime = mimeType || getMimeFromDataUri(dataUri) || 'image/jpeg';
  const [header, encodedData] = dataUri.split(',');
  const isBase64 = header && header.includes('base64');

  let binaryString = '';
  if (isBase64) {
    binaryString = atob(encodedData || '');
  } else {
    binaryString = decodeURIComponent(encodedData || '');
  }

  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return new Blob([bytes], { type: normalizedMime });
}

function dataUriToFile(dataUri, filename, mimeType) {
  const blob = dataUriToBlob(dataUri, mimeType);
  if (!blob) {
    return null;
  }

  const cleanMime = mimeType || getMimeFromDataUri(dataUri) || 'image/jpeg';
  const extension = cleanMime.split('/')[1] || 'jpg';
  const safeFileName = filename || `generated-image.${extension}`;
  return new File([blob], safeFileName, { type: cleanMime, lastModified: Date.now() });
}

function parseResponseBody(response) {
  if (!response) {
    return null;
  }

  if (typeof response === 'string') {
    try {
      return JSON.parse(response);
    } catch (error) {
      return response;
    }
  }

  return response;
}

async function callOptimizeApiForUrl(url) {
  const response = await fetch(OPTIMIZE_API_URL, {
    method: 'POST',
    body: 'fileuri=' + encodeURIComponent(url),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    }
  });

  const body = parseResponseBody(await response.text());
  return {
    url,
    ok: response.ok,
    status: response.status,
    body
  };
}

function normalizeGeneratedImages(apiBody) {
  const list = Array.isArray(apiBody?.images) ? apiBody.images : [];

  return list
    .map((image, index) => {
      const dataUri = typeof image?.data_uri === 'string' ? image.data_uri : null;
      const mimeType = typeof image?.mime_type === 'string' ? image.mime_type : getMimeFromDataUri(dataUri);

      if (!dataUri || !mimeType) {
        return null;
      }

      const fileName = image?.filename || `generated-${index + 1}.${(mimeType.split('/')[1] || 'jpg')}`;
      const file = dataUriToFile(dataUri, fileName, mimeType);

      if (!file) {
        return null;
      }

      return {
        originalIndex: index,
        filename: fileName,
        mimeType,
        dataUri,
        previewUrl: dataUri,
        file
      };
    })
    .filter(Boolean);
}

async function uploadImageToMeesho(imageFile) {
  const formData = new FormData();
  formData.append('file', imageFile, imageFile?.name || 'generated-image.jpg');
  formData.append('data', 'undefined');

  const response = await fetch(UPLOAD_API_URL, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Unable to upload image to Meesho.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error('Unable to parse the Meesho upload response.');
  }

  const imageUrl = payload?.image || payload?.data?.image || payload?.result?.image;
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('Meesho upload did not return an image URL.');
  }

  return imageUrl;
}

async function fetchShippingRecommendation(imageUrl, catalogId) {
  const numericCatalogId = Number(catalogId);
  if (!imageUrl || !Number.isFinite(numericCatalogId)) {
    throw new Error('Missing Meesho catalog context for shipping comparison.');
  }

  const requestBody = {
    is_old_image_match_enabled: false,
    sscat_id: numericCatalogId,
    image_url: imageUrl
  };

  const response = await fetch(SHIPPING_API_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json, text/plain, */*'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error('Unable to calculate shipping cost for this image.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error('Unable to parse the shipping recommendation response.');
  }

  if (payload?.errors) {
    throw new Error('Meesho reported an error while checking shipping.');
  }

  const data = payload?.data || {};
  const shippingCharge = Number(data.wu_shipping_charge);
  const duplicatePid = data.duplicate_pid ?? data.duplicatePid ?? null;

  if (!Number.isFinite(shippingCharge)) {
    throw new Error('Meesho shipping charge could not be determined.');
  }

  return {
    shippingCharge,
    duplicatePid
  };
}

async function processGeneratedImages(images, catalogId) {
  const results = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const result = {
      originalIndex: image.originalIndex,
      filename: image.filename,
      mimeType: image.mimeType,
      file: image.file,
      previewUrl: image.previewUrl,
      uploadedImageUrl: null,
      shippingCharge: null,
      duplicatePid: null,
      success: false,
      error: null,
      uploadStatus: 'pending',
      shippingStatus: 'pending'
    };

    try {
      result.uploadStatus = 'running';
      result.uploadedImageUrl = await uploadImageToMeesho(image.file);
      result.uploadStatus = 'success';

      result.shippingStatus = 'running';
      const shipping = await fetchShippingRecommendation(result.uploadedImageUrl, catalogId);
      result.shippingCharge = shipping.shippingCharge;
      result.duplicatePid = shipping.duplicatePid;
      result.shippingStatus = 'success';
      result.success = true;
    } catch (error) {
      result.error = error && error.message ? error.message : 'Image processing failed.';
      result.uploadStatus = result.uploadedImageUrl ? 'success' : 'failed';
      result.shippingStatus = 'failed';
      result.success = false;
    }

    results.push(result);
  }

  return results;
}

function selectLowestShippingImage(results) {
  const validResults = results.filter((result) => result.success && Number.isFinite(Number(result.shippingCharge)));
  if (!validResults.length) {
    return null;
  }

  return validResults.reduce((best, current) => {
    const bestCharge = Number(best.shippingCharge);
    const currentCharge = Number(current.shippingCharge);
    return currentCharge < bestCharge ? current : best;
  }, validResults[0]);
}

async function runImageComparisonFlow() {
  const urls = getUploadedImageUrls();
  if (!urls.length) {
    return {
      success: false,
      message: 'No generated images were found on this page.',
      results: [],
      bestImage: null
    };
  }

  const catalogId = getCurrentSubSubCategoryId();
  if (catalogId == null) {
    return {
      success: false,
      message: 'Meesho catalog context is unavailable. Please reload the Meesho page and try again.',
      results: [],
      bestImage: null
    };
  }

  const optimizeResults = [];
  for (const url of urls) {
    try {
      const response = await callOptimizeApiForUrl(url);
      optimizeResults.push(response);
    } catch (error) {
      optimizeResults.push({
        url,
        ok: false,
        status: 0,
        body: null,
        error: String(error)
      });
    }
  }

  const generatedImages = optimizeResults
    .map((result) => normalizeGeneratedImages(result.body))
    .flat();

  if (!generatedImages.length) {
    return {
      success: false,
      message: 'No valid generated images were returned by the image optimization API.',
      results: [],
      bestImage: null
    };
  }

  const processedResults = await processGeneratedImages(generatedImages, catalogId);
  const bestImage = selectLowestShippingImage(processedResults);

  if (!bestImage) {
    return {
      success: false,
      message: 'Unable to find a shipping recommendation for the generated images.',
      results: processedResults,
      bestImage: null
    };
  }

  return {
    success: true,
    message: 'Best image selected by lowest shipping charge.',
    results: processedResults,
    bestImage: {
      originalIndex: bestImage.originalIndex,
      filename: bestImage.filename,
      mimeType: bestImage.mimeType,
      uploadedImageUrl: bestImage.uploadedImageUrl,
      shippingCharge: bestImage.shippingCharge,
      duplicatePid: bestImage.duplicatePid,
      previewUrl: bestImage.previewUrl,
      downloadUrl: bestImage.previewUrl
    }
  };
}

const normalizeImageResult = (image, index) => ({
	originalIndex: index,
	filename: image?.filename || `generated-image-${index + 1}.jpg`,
	mimeType: image?.mime_type || 'image/jpeg',
	sizeKb: Number(image?.size_kb) || 0,
	uploadedImageUrl: null,
	shippingCharge: null,
	duplicatePid: null,
	uploadStatus: 'pending',
	shippingStatus: 'pending',
	error: null
});

function getSubSubCategoryId() {
	const rawValue = window.__MEESHO_EXTENSION_CONTEXT__?.sub_sub_category_id ?? PAGE_CONTEXT.sub_sub_category_id ?? null;
	if (rawValue == null || rawValue === '') return null;
	const parsedValue = Number(rawValue);
	return Number.isFinite(parsedValue) ? parsedValue : null;
}

async function getOptimizedImageResponse(imageUrl) {
	if (USE_MOCK_API_RESPONSE) {
		return {
			ok: true,
			status: 200,
			async json() {
				return MOCK_API_RESPONSE;
			},
			async text() {
				return JSON.stringify(MOCK_API_RESPONSE);
			}
		};
	}

	const response = await fetch(OPTIMIZE_API_URL, {
		method: 'POST',
		body: 'fileuri=' + encodeURIComponent(imageUrl),
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			accept: 'application/json'
		}
	});

	return response;
}

async function uploadImageToMeesho(imageFile, context) {
	if (!(imageFile instanceof File)) {
		throw new Error('Invalid image file for Meesho upload');
	}

	const formData = new FormData();
	formData.append('file', imageFile);
	formData.append('data', 'undefined');

	const headers = {
		accept: 'application/json, text/plain, */*',
		'accept-language': 'en-US,en;q=0.9',
		'client-package-version': '1.0.1',
		'client-type': 'd-web',
		origin: 'https://supplier.meesho.com',
		referer: context.referer || 'https://supplier.meesho.com/'
	};

	if (context.browserId) headers['browser-id'] = String(context.browserId);
	if (context.identifier) headers.identifier = String(context.identifier);
	if (context.supplierId) headers['supplier-id'] = String(context.supplierId);

		console.log('Meesho upload request', {
		url: MEESHO_UPLOAD_API_URL,
		fileName: imageFile?.name,
		headers,
		formDataKeys: ['file', 'data']
	});

	const response = await fetch(MEESHO_UPLOAD_API_URL, {
		method: 'POST',
		credentials: 'include',
		headers,
		body: formData
	});

	let uploadResponse;
	try {
		uploadResponse = await response.json();
	} catch (error) {
		const text = await response.text();
		console.error('Meesho upload raw response text', text);
		throw new Error(text || 'Meesho upload failed');
	}

	console.log('Meesho upload response', {
		status: response.status,
		ok: response.ok,
		body: uploadResponse
	});

	if (!response.ok || !uploadResponse || !uploadResponse.image) {
		throw new Error(uploadResponse?.message || 'Meesho upload failed');
	}

	if (!isValidHttpUrl(uploadResponse.image)) {
		throw new Error('Meesho upload returned an invalid image URL');
	}

	return uploadResponse.image;
}

async function fetchShippingRecommendation(uploadedImageUrl, subSubCategoryId, context) {
	if (!isValidHttpUrl(uploadedImageUrl)) {
		throw new Error('Uploaded image URL is invalid');
	}

	const payload = {
		is_old_image_match_enabled: false,
		sscat_id: Number(subSubCategoryId),
		image_url: uploadedImageUrl
	};

	const headers = {
		Accept: 'application/json, text/plain, */*',
		'Content-Type': 'application/json;charset=UTF-8',
		'client-package-version': '1.0.1',
		'client-type': 'd-web',
		origin: 'https://supplier.meesho.com',
		referer: context.referer || 'https://supplier.meesho.com/'
	};

	if (context.browserId) headers['browser-id'] = String(context.browserId);
	if (context.identifier) headers.identifier = String(context.identifier);
	if (context.supplierId) headers['supplier-id'] = String(context.supplierId);

	console.log('Meesho shipping request', {
		url: MEESHO_SHIPPING_API_URL,
		payload,
		headers
	});

	const response = await fetch(MEESHO_SHIPPING_API_URL, {
		method: 'POST',
		credentials: 'include',
		headers,
		body: JSON.stringify(payload)
	});

	let responseBody;
	try {
		responseBody = await response.json();
	} catch (error) {
		const text = await response.text();
		console.error('Meesho shipping raw response text', text);
		throw new Error(text || 'Shipping recommendation fetch failed');
	}

	console.log('Meesho shipping response', {
		status: response.status,
		ok: response.ok,
		body: responseBody
	});

	if (!response.ok || !responseBody || !responseBody.data) {
		throw new Error(responseBody?.errors || 'Shipping recommendation fetch failed');
	}

	const shippingCharge = Number(responseBody.data.wu_shipping_charge);
	if (!Number.isFinite(shippingCharge)) {
		throw new Error('Missing or invalid wu_shipping_charge');
	}

	return {
		duplicatePid: responseBody.data.duplicate_pid ?? null,
		shippingCharge
	};
}

async function processGeneratedImage(image, index, subSubCategoryId, context) {
	const result = normalizeImageResult(image, index);

	try {
		if (!image || typeof image !== 'object') {
			throw new Error('Invalid optimized image payload');
		}

		if (!image.data_uri || typeof image.data_uri !== 'string') {
			throw new Error('Invalid image data URI');
		}

		const file = dataUriToFile(image.data_uri, image.filename, image.mime_type);
		result.uploadStatus = 'uploading';
		const uploadedImageUrl = await uploadImageToMeesho(file, context);
		result.uploadedImageUrl = uploadedImageUrl;
		result.uploadStatus = 'success';
		result.shippingStatus = 'fetching';

		const shipping = await fetchShippingRecommendation(uploadedImageUrl, subSubCategoryId, context);
		result.duplicatePid = shipping.duplicatePid;
		result.shippingCharge = Number(shipping.shippingCharge);
		result.shippingStatus = 'success';
		result.error = null;
	} catch (error) {
		result.uploadStatus = 'failed';
		result.shippingStatus = 'failed';
		result.error = error && error.message ? error.message : String(error);
		console.error('Failed to process generated image', { image: result.filename, error });
	}

	return result;
}

function selectLowestShippingImage(results) {
	const validResults = (results || []).filter((item) => {
		if (!item || !item.uploadedImageUrl) return false;
		const value = Number(item.shippingCharge);
		return Number.isFinite(value);
	});

	if (!validResults.length) {
		return null;
	}

	validResults.sort((a, b) => Number(a.shippingCharge) - Number(b.shippingCharge));
	return validResults[0];
}

async function processOptimizedImagesForCurrentPage() {
	const currentPageContext = getPageContext();
	const subSubCategoryId = getSubSubCategoryId();

	if (subSubCategoryId == null) {
		throw new Error('Missing sub_sub_category_id. The page request must include the actual Meesho sub-sub-category ID.');
	}

	const rawImageUrls = getUploadedImageUrls();
	const optimizeResults = [];

	for (const imageUrl of rawImageUrls) {
		try {
			const optimizeResponse = await getOptimizedImageResponse(imageUrl);
			let body = null;
			try {
				body = await optimizeResponse.json();
			} catch (error) {
				body = await optimizeResponse.text();
			}
			console.log('Optimize API response for', imageUrl, { ok: optimizeResponse.ok, status: optimizeResponse.status, body });
			optimizeResults.push({ url: imageUrl, ok: optimizeResponse.ok, status: optimizeResponse.status, body });
		} catch (error) {
			console.error('Error sending image to optimize API for', imageUrl, error);
			optimizeResults.push({ url: imageUrl, ok: false, error: String(error) });
		}
	}

	const generatedResults = [];
	for (const optimizeResult of optimizeResults) {
		const body = optimizeResult?.body;
		if (!body || !Array.isArray(body.images) || !body.images.length) {
			if (optimizeResult?.ok === false) {
				generatedResults.push({
					filename: 'optimize-error',
					uploadedImageUrl: null,
					shippingCharge: null,
					duplicatePid: null,
					uploadStatus: 'failed',
					shippingStatus: 'failed',
					error: optimizeResult.error || 'Optimize API returned no images',
					originalIndex: generatedResults.length
				});
			}
			continue;
		}

		for (let i = 0; i < body.images.length; i += 1) {
			const image = body.images[i];
			const processed = await processGeneratedImage(image, i, subSubCategoryId, currentPageContext);
			generatedResults.push(processed);
		}
	}

	const selected = selectLowestShippingImage(generatedResults);
	const fallbackMessage = selected ? 'Selected lowest shipping charge image.' : 'No valid Meesho shipping result was found.';
	const result = {
		success: Boolean(selected),
		message: fallbackMessage,
		results: generatedResults,
		bestImage: selected ? {
			filename: selected.filename,
			previewUrl: selected.uploadedImageUrl,
			downloadUrl: selected.uploadedImageUrl,
			downloadName: selected.filename,
			shippingCharge: Number(selected.shippingCharge),
			duplicatePid: selected.duplicatePid,
			uploadedImageUrl: selected.uploadedImageUrl,
			originalIndex: selected.originalIndex
		} : null
	};

	console.log('Final Meesho comparison results:', result);
	return result;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'runAnalysis') {
      (async () => {
        try {
          const analysis = await runImageComparisonFlow();
          sendResponse(analysis);
        } catch (error) {
          console.error('Image comparison flow failed.', error);
          sendResponse({
            success: false,
            message: 'Unable to compare the generated images right now.',
            results: [],
            bestImage: null
          });
        }
      })();
      return true;
    }
  });
}
