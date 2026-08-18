"""
BiRefNet Background Remover
============================
Removes image backgrounds using the BiRefNet segmentation model and
optionally composites the foreground onto a light, color-matched
adaptive background.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple, Union

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

PathLike = Union[str, Path]
RGBColor = Tuple[int, int, int]


class BiRefNetBackgroundRemover:
    """Background removal and adaptive background generation using BiRefNet."""

    MODEL_NAME = "ZhengPeng7/BiRefNet"
    IMAGE_SIZE = (1024, 1024)
    NORM_MEAN = [0.485, 0.456, 0.406]
    NORM_STD = [0.229, 0.224, 0.225]

    # Adaptive-background tuning
    MAX_KMEANS_SAMPLES = 10_000
    KMEANS_CLUSTERS = 5
    FOREGROUND_THRESHOLD = 128
    FALLBACK_COLOR: RGBColor = (200, 200, 200)

    def __init__(self, device: Optional[str] = None):
        """
        Args:
            device: "cuda", "cpu", or None (auto-detect).
        """
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = self._load_model()
        self.transform = self._build_transform()

    # ------------------------------------------------------------------
    # Model setup
    # ------------------------------------------------------------------

    def _load_model(self):
        model = AutoModelForImageSegmentation.from_pretrained(
            self.MODEL_NAME, trust_remote_code=True
        )
        model.to(self.device).float().eval()
        print(f"BiRefNet loaded on: {self.device}")
        return model

    def _build_transform(self):
        return transforms.Compose([
            transforms.Resize(self.IMAGE_SIZE),
            transforms.ToTensor(),
            transforms.Normalize(self.NORM_MEAN, self.NORM_STD),
        ])

    # ------------------------------------------------------------------
    # Segmentation
    # ------------------------------------------------------------------

    @staticmethod
    def _load_image(image_path: PathLike) -> Image.Image:
        return Image.open(image_path).convert("RGB")

    def _generate_mask(self, image: Image.Image) -> Image.Image:
        """Run BiRefNet and return a foreground mask resized to the original image."""
        input_tensor = self.transform(image).unsqueeze(0).to(self.device)

        with torch.no_grad():
            prediction = self.model(input_tensor)[-1]

        mask = prediction.sigmoid().cpu()[0][0]
        mask = transforms.ToPILImage()(mask)
        return mask.resize(image.size)

    # ------------------------------------------------------------------
    # Dominant color extraction
    # ------------------------------------------------------------------

    def _extract_foreground_pixels(self, image: Image.Image, mask: Image.Image) -> np.ndarray:
        """Return only high-confidence foreground pixels, so the background can't skew color selection."""
        image_array = np.array(image)
        mask_array = np.array(mask)
        foreground = mask_array > self.FOREGROUND_THRESHOLD
        return image_array[foreground]

    def _extract_dominant_color(self, image: Image.Image, mask: Image.Image) -> RGBColor:
        """Find the dominant foreground color via K-means clustering."""
        pixels = self._extract_foreground_pixels(image, mask)

        if len(pixels) == 0:
            return self.FALLBACK_COLOR

        if len(pixels) > self.MAX_KMEANS_SAMPLES:
            indices = np.random.choice(len(pixels), self.MAX_KMEANS_SAMPLES, replace=False)
            pixels = pixels[indices]

        pixels = np.float32(pixels)
        k = min(self.KMEANS_CLUSTERS, len(pixels))
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)

        _, labels, centers = cv2.kmeans(pixels, k, None, criteria, 10, cv2.KMEANS_PP_CENTERS)

        dominant_index = np.argmax(np.bincount(labels.flatten()))
        r, g, b = np.clip(centers[dominant_index], 0, 255).astype(np.uint8)
        return int(r), int(g), int(b)

    # ------------------------------------------------------------------
    # Adaptive background color
    # ------------------------------------------------------------------

    def _create_adaptive_color(
        self,
        rgb_color: RGBColor,
        lightness: float = 0.88,
        saturation_reduction: float = 0.35,
    ) -> RGBColor:
        """
        Lighten and desaturate a dominant color into a soft background color.

        Args:
            rgb_color: Dominant RGB color.
            lightness: Target HLS lightness blend factor (0.88 = very light).
            saturation_reduction: Fraction to reduce saturation by.
        """
        hls = cv2.cvtColor(np.uint8([[rgb_color]]), cv2.COLOR_RGB2HLS)
        h, l, s = hls[0][0]

        new_lightness = min(int(l + (255 - l) * lightness), 245)
        new_saturation = max(20, min(int(s * (1 - saturation_reduction)), 180))

        hls[0][0] = [h, new_lightness, new_saturation]
        r, g, b = cv2.cvtColor(hls, cv2.COLOR_HLS2RGB)[0][0]
        return int(r), int(g), int(b)

    def _compute_adaptive_background(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        """Derive a light, color-matched background from the image's dominant foreground color."""
        dominant_color = self._extract_dominant_color(image, mask)
        adaptive_color = self._create_adaptive_color(dominant_color)

        print(f"Dominant color: {dominant_color}")
        print(f"Adaptive background: {adaptive_color}")

        return Image.new("RGB", image.size, adaptive_color)

    # ------------------------------------------------------------------
    # Compositing
    # ------------------------------------------------------------------

    @staticmethod
    def _composite_image(image: Image.Image, mask: Image.Image, background: Image.Image) -> Image.Image:
        """Composite the foreground (cut out via mask) over a background."""
        foreground = image.convert("RGBA")
        foreground.putalpha(mask)
        return Image.alpha_composite(background.convert("RGBA"), foreground)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def remove_background(
        self, image_path: PathLike, output_path: Optional[PathLike] = None
    ) -> Tuple[Image.Image, Image.Image]:
        """
        Remove the background and return a transparent RGBA image.

        Args:
            image_path: Input image path.
            output_path: Optional path to save the transparent PNG.

        Returns:
            (rgba_image, mask)
        """
        image = self._load_image(image_path)
        mask = self._generate_mask(image)

        rgba_image = image.convert("RGBA")
        rgba_image.putalpha(mask)

        if output_path:
            rgba_image.save(output_path)

        return rgba_image, mask

    def generate_adaptive_background(
        self, image: Image.Image, mask: Image.Image, output_path: Optional[PathLike] = None
    ) -> Image.Image:
        """
        Generate a light adaptive background matched to the image's dominant foreground color.

        Args:
            image: Original RGB image.
            mask: Foreground mask (e.g. from remove_background).
            output_path: Optional path to save the background.

        Returns:
            The generated background image.
        """
        background = self._compute_adaptive_background(image, mask)

        if output_path:
            background.save(output_path)

        return background

    def process(
        self,
        image_path: PathLike,
        output_path: PathLike = "adaptive_background.png",
        transparent_output: Optional[PathLike] = None,
    ) -> Image.Image:
        """
        Full pipeline: segment -> extract dominant color -> build adaptive
        background -> composite -> save.

        Args:
            image_path: Input image.
            output_path: Path to save the final composited image.
            transparent_output: Optional path to also save a transparent PNG.

        Returns:
            The final composited image.
        """
        image = self._load_image(image_path)
        mask = self._generate_mask(image)

        background = self._compute_adaptive_background(image, mask)
        result = self._composite_image(image, mask, background)
        result.save(output_path)

        if transparent_output:
            transparent_image = image.convert("RGBA")
            transparent_image.putalpha(mask)
            transparent_image.save(transparent_output)
            print(f"Transparent: {transparent_output}")

        print(f"Generated: {output_path}")
        return result


# ========================================================================
# USAGE
# ========================================================================

def main():
    image_rel_path = Path("images/images (1).jpg")
    project_root = Path.cwd() if (Path.cwd() / "images").exists() else Path.cwd().parent
    input_image = (project_root / image_rel_path).resolve()

    remover = BiRefNetBackgroundRemover()
    remover.process(image_path=input_image, output_path=input_image)


if __name__ == "__main__":
    main()