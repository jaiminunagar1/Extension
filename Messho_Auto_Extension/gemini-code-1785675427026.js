document.getElementById('startBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('imageInput');
  if (!fileInput.files[0]) {
    alert("Please select an image first!");
    return;
  }

  const status = document.getElementById('status');
  status.innerText = "Generating variants...";

  const baseImageFile = fileInput.files[0];
  
  // 1. Generate Image Variants (different dimensions / compressions)
  const variants = await generateVariants(baseImageFile);
  
  status.innerText = "Testing variants on Meesho...";

  // 2. Send image variants to the active tab running content.js
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "TEST_VARIANTS", variants: variants });
});

// Canvas logic to generate different variants of the image
async function generateVariants(file) {
  const img = await loadImage(file);
  const variants = [];

  // Configs: Variant 1 (Square 800x800), Variant 2 (Portait 800x1000), Variant 3 (Compressed)
  const configs = [
    { name: "Variant 1 (Square 800x800)", width: 800, height: 800, quality: 0.9 },
    { name: "Variant 2 (Square Compressed 600x600)", width: 600, height: 600, quality: 0.7 },
    { name: "Variant 3 (Portrait 800x1000)", width: 800, height: 1000, quality: 0.85 }
  ];

  for (let cfg of configs) {
    const canvas = document.createElement('canvas');
    canvas.width = cfg.width;
    canvas.height = cfg.height;
    const ctx = canvas.getContext('2d');
    
    // Draw white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cfg.width, cfg.height);

    // Scale and draw image centered
    ctx.drawImage(img, 0, 0, cfg.width, cfg.height);
    
    // Convert canvas back to Blob Base64
    const dataUrl = canvas.toDataURL('image/jpeg', cfg.quality);
    variants.push({ name: cfg.name, dataUrl: dataUrl });
  }

  return variants;
}

function loadImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = URL.createObjectURL(file);
  });
}