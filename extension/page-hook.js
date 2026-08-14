(() => {
  if (window.__MY_EXTENSION_API_HOOK_INSTALLED) {
    return;
  }

  window.__MY_EXTENSION_API_HOOK_INSTALLED = true;

  const TARGETS = [
    '/api/cataloging/singleCatalogUploadDesktop/fetchProductDetailsV3'
];

  const isTargetUrl = (url) => {
    if (typeof url !== 'string') return false;
    return TARGETS.some((target) => url.includes(target));
  };

  const getRequestBody = async (input, init) => {
    let body = init && 'body' in init ? init.body : undefined;

    if (body === undefined && input && typeof input === 'object') {
      body = input.body;
    }

    if (body instanceof ReadableStream) {
      return '[ReadableStream]';
    }

    if (body === undefined && input && typeof input === 'object' && typeof input.clone === 'function') {
      try {
        const clonedRequest = input.clone();
        const text = await clonedRequest.text();
        if (text) {
          return text;
        }
      } catch (error) {
        return '[RequestBody]';
      }
    }

    if (body === undefined) {
      return '[No body]';
    }

    return body;
  };

  const parseResponseBody = async (response) => {
    try {
      const clonedResponse = response.clone();
      const text = await clonedResponse.text();

      if (!text || text.trim() === '') {
        return null;
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        return text;
      }
    } catch (error) {
      return null;
    }
  };

  const extractSubSubCategoryId = (body) => {
    try {
      if (!body) return null;

      const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
      return parsedBody?.sub_sub_category_id ?? null;
    } catch (error) {
      return null;
    }
  };

  const notifyInterceptedRequest = (payload) => {
    const sub_sub_category_id = extractSubSubCategoryId(payload?.requestBody);

    try {
      window.postMessage(
        {
          source: 'MY_EXTENSION',
          type: 'API_INTERCEPTED',
          payload: {
            ...payload,
            sub_sub_category_id
          }
        },
        '*'
      );
    } catch (error) {
      console.warn('API interceptor: message dispatch failed.', error);
    }
  };

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    try {
      const input = args[0];
      const init = args[1] || {};
      const url = typeof input === 'string'
        ? input
        : input && typeof input === 'object' && typeof input.url === 'string'
          ? input.url
          : undefined;

      if (!isTargetUrl(url)) {
        return originalFetch.apply(this, args);
      }

      const method = init.method || (input && input.method) || 'GET';
      const requestBody = await getRequestBody(input, init);
      const response = await originalFetch.apply(this, args);
      const responseBody = await parseResponseBody(response);
      const sub_sub_category_id = extractSubSubCategoryId(requestBody);

      notifyInterceptedRequest({
        url,
        method,
        requestBody,
        response: responseBody,
        status: response.status,
        sub_sub_category_id
      });

      return response;
    } catch (error) {
      console.warn('API interceptor: fetch interception failed.', error);
      return originalFetch.apply(this, args);
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._interceptedUrl = typeof url === 'string' ? url : String(url || '');
    this._interceptedMethod = method || 'GET';
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this;

    if (isTargetUrl(xhr._interceptedUrl)) {
      const requestBody = body;

      xhr.addEventListener(
        'loadend',
        () => {
          try {
            let responseData = xhr.responseText;

            if (typeof xhr.responseText === 'string' && xhr.responseText.trim()) {
              try {
                responseData = JSON.parse(xhr.responseText);
              } catch (error) {
                responseData = xhr.responseText;
              }
            }

            const sub_sub_category_id = extractSubSubCategoryId(requestBody);

            notifyInterceptedRequest({
              url: xhr._interceptedUrl,
              method: xhr._interceptedMethod,
              requestBody,
              response: responseData,
              status: xhr.status,
              sub_sub_category_id
            });
          } catch (error) {
            console.warn('API interceptor: XHR interception failed.', error);
          }
        },
        { once: true }
      );
    }

    return originalSend.call(this, body);
  };
})();
