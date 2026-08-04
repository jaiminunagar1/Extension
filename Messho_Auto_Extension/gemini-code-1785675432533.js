chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "TEST_VARIANTS") {
    runOptimizationLoop(request.variants);
  }
});

async function runOptimizationLoop(variants) {
  let results = [];

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    console.log(`Testing ${variant.name}...`);

    // 1. Convert base64 data back to File object
    const file = dataURLtoFile(variant.dataUrl, `variant_${i}.jpg`);

    // 2. Inject image into Meesho upload input
    await uploadImageToMeesho(file);

    // 3. Trigger YOUR clickable point (Calculate shipping price button)
    await clickCalculateShippingPoint();

    // 4. Wait for Meesho UI to calculate & read the shipping price text
    const shippingPrice = await readShippingPrice();
    
    results.push({
      variant: variant,
      price: shippingPrice
    });
  }

  // 5. Find the lowest shipping price variant
  results.sort((a, b) => a.price - b.price);
  const bestVariant = results[0];

  alert(`Best Image Found!\nVariant: ${bestVariant.variant.name}\nLowest Shipping Fee: ₹${bestVariant.price}`);

  // Re-upload the best variant to leave it selected on screen
  const finalFile = dataURLtoFile(bestVariant.variant.dataUrl, 'best_variant.jpg');
  await uploadImageToMeesho(finalFile);
}

// Injects a file into an HTML <input type="file"> programmatically
async function uploadImageToMeesho(file) {
  // REPLACE Selector with Meesho's actual image input element
  const fileInput = document.querySelector('input[type="file"]'); 

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;

  // Trigger change event so React/Angular on Meesho detects the upload
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await delay(1500); // Wait for upload UI to react
}

// Simulates clicking the button you mentioned
async function clickCalculateShippingPoint() {
  // REPLACE Selector with your click point button element/class
  const calculateBtn = document.querySelector('#your-click-point-btn-selector'); 
  if (calculateBtn) {
    calculateBtn.click();
  }
  await delay(2000); // Wait 2 seconds for server calculation API to return
}

// Reads the price text from screen and converts to a number
async function readShippingPrice() {
  // REPLACE Selector with element that displays the shipping price text
  const priceElement = document.querySelector('#shipping-price-selector'); 
  if (priceElement) {
    const priceText = priceElement.innerText; // e.g. "₹65"
    return parseFloat(priceText.replace(/[^0-9.]/g, '')) || 9999;
  }
  return 9999;
}

// Utility: Converts Data URL to File Object
function dataURLtoFile(dataurl, filename) {
  let arr = dataurl.split(','),
      mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), 
      n = bstr.length, 
      u8arr = new Uint8Array(n);
  while(n--){
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, {type:mime});
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));