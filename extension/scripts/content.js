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
