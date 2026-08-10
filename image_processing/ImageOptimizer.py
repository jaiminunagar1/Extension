"""
Image Optimizer
===============

Supports:
- JPEG, PNG, WebP, BMP, TIFF input
- Resize while preserving aspect ratio
- Target maximum dimensions
- Target maximum file size
- JPEG/WebP binary-search quality optimization
- PNG palette optimization

Converted from Image_Optimizer.ipynb into a single class.
"""
from PIL import Image, ImageEnhance
from pathlib import Path
import io
import os


class ImageOptimizer:
    """
    Encapsulates all image-optimization behavior from the original notebook.

    All the values that used to live in the notebook's
    "USER CONFIGURATION" cell are now constructor arguments with the
    same defaults, so `ImageOptimizer()` behaves exactly like the notebook.
    """

    # -------------------------------------------------------------
    # Class-level defaults (mirrors the notebook's SCALES constant)
    # -------------------------------------------------------------
    SCALES = (1.0, 0.75, 0.50, 0.25)  # Configurable

    def __init__(
        self,
        image_rel_path: str = r"images\Product 1\white_bg (3).png",
        project_root: Path | None = None,
        output_format: str = "same",          # same, jpeg, png, webp
        max_width: int = 333,
        max_height: int = 500,
        target_size_kb: int = 30,
        resize: bool = True,
        compress: bool = True,
        keep_aspect: bool = True,              # False = force exact size
        jpeg_min_quality: int = 20,
        jpeg_max_quality: int = 95,
        webp_min_quality: int = 20,
        webp_max_quality: int = 95,
        sharpness_factor: float = 1.5,
        contrast_factor: float = 0.80,
        scales: tuple = None,
    ):
        # ==========================
        # USER CONFIGURATION
        # (previously a standalone cell — now instance attributes)
        # ==========================
        self.image_rel_path = Path(image_rel_path)
        self.project_root = (
            project_root
            if project_root is not None
            else (Path.cwd() if (Path.cwd() / "images").exists() else Path.cwd().parent)
        )
        self.input_image = str((self.project_root / self.image_rel_path).resolve())

        self.output_format = output_format

        self.max_width = max_width
        self.max_height = max_height

        self.target_size_kb = target_size_kb

        self.resize_enabled = resize
        self.compress = compress
        self.keep_aspect = keep_aspect


        self.jpeg_min_quality = jpeg_min_quality
        self.jpeg_max_quality = jpeg_max_quality

        self.webp_min_quality = webp_min_quality
        self.webp_max_quality = webp_max_quality

        self.sharpness_factor = sharpness_factor
        self.contrast_factor = contrast_factor

        self.scales = scales if scales is not None else self.SCALES

    # -------------------------------------------------------------
    # Info / helper utilities
    # -------------------------------------------------------------
    def file_size_kb(self, path):
        return os.path.getsize(path) / 1024

    def image_info(self, path):
        img = Image.open(path)
        return {
            "format": img.format,
            "mode": img.mode,
            "width": img.width,
            "height": img.height,
            "size_kb": self.file_size_kb(path),
        }

    def print_info(self, title, info):
        print("=" * 40)
        print(title)
        for k, v in info.items():
            print(f"{k:10}: {v}")

    # -------------------------------------------------------------
    # Sizing / resizing
    # -------------------------------------------------------------
    def generate_image_sizes(self, image_path, scales=None):
        scales = scales if scales is not None else self.scales

        info = self.image_info(image_path)

        width = info["width"]
        height = info["height"]

        versions = []

        for scale in scales:
            if scale >= 1:
                continue  # Skip original size

            versions.append(
                {
                    "scale": scale,
                    "width": int(width * scale),
                    "height": int(height * scale),
                }
            )

        return versions

    def resize_image(self, img, width, height):
        if not self.resize_enabled:
            return img.copy()

        return img.resize((width, height), Image.LANCZOS)

    # -------------------------------------------------------------
    # Format-specific savers
    # -------------------------------------------------------------
    def save_jpeg(self, img, output, target_kb):
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")

        low = self.jpeg_min_quality
        high = self.jpeg_max_quality
        best = None

        while low <= high:
            q = (low + high) // 2
            buf = io.BytesIO()

            img.save(buf, format="JPEG", quality=q, optimize=False)

            size = len(buf.getvalue()) / 1024

            if size <= target_kb:
                best = buf.getvalue()
                low = q + 1
            else:
                high = q - 1

        if best is None:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=self.jpeg_min_quality, optimize=False)
            best = buf.getvalue()

        with open(output, "wb") as f:
            f.write(best)

    def save_webp(self, img, output, target_kb):
        low = self.webp_min_quality
        high = self.webp_max_quality
        best = None

        while low <= high:
            q = (low + high) // 2

            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=q, method=6)

            size = len(buf.getvalue()) / 1024

            if size <= target_kb:
                best = buf.getvalue()
                low = q + 1
            else:
                high = q - 1

        if best is None:
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=self.webp_min_quality, method=6)
            best = buf.getvalue()

        with open(output, "wb") as f:
            f.write(best)

    def save_png(self, img, output, target_kb):
        # palette_sizes = [256, 128, 64, 32, 16, 8, 4]
        palette_sizes = [256, 128, 64, 32]

        best = None

        for colors in palette_sizes:
            test = img.convert("P", palette=Image.ADAPTIVE, colors=colors)

            buf = io.BytesIO()
            test.save(buf, format="PNG", optimize=True, compress_level=9)

            size = len(buf.getvalue()) / 1024

            best = buf.getvalue()

            if size <= target_kb:
                print(f"Achieved target size with {colors} colors.")
                break

        with open(output, "wb") as f:
            f.write(best)

    # -------------------------------------------------------------
    # Image enhancement helpers (previously nested functions)
    # -------------------------------------------------------------
    def _enhance_image(self, img):
        enhancer = ImageEnhance.Sharpness(img)
        return enhancer.enhance(self.sharpness_factor)

    # -------------------------------------------------------------
    # Main pipeline
    # -------------------------------------------------------------
    def optimize_image(self, input_path=None):
        input_path = input_path if input_path is not None else self.input_image

        # -------------------------
        # Original Image Info
        # -------------------------
        info = self.image_info(input_path)
        self.print_info("Original", info)

        # Generate all resize versions
        sizes = self.generate_image_sizes(input_path)

        # Output format
        fmt = self.output_format.lower()

        if fmt == "same":
            fmt = info["format"].lower()

        input_file = Path(input_path)

        output_dir = input_file.parent / "optimised"
        output_dir.mkdir(parents=True, exist_ok=True)

        # Open original image only once
        original_img = Image.open(input_path)

        generated_files = []

        # -------------------------
        # Generate Images
        # -------------------------
        for version in sizes:

            img = self.resize_image(
                original_img.copy(),
                version["width"],
                version["height"],
            )
            img = self._enhance_image(img)

            output = output_dir / f"{input_file.stem}_{version['width']}x{version['height']}"

            if fmt in ("jpg", "jpeg"):
                output = output.with_suffix(".jpg")
                self.save_jpeg(img, str(output), self.target_size_kb)

            elif fmt == "png":
                output = output.with_suffix(".png")
                self.save_png(img, str(output), self.target_size_kb)

            elif fmt == "webp":
                output = output.with_suffix(".webp")
                self.save_webp(img, str(output), self.target_size_kb)

            else:
                raise ValueError(f"Unsupported output format: {fmt}")

            generated_files.append(str(output))

            print(version)

            self.print_info(
                f"Optimized ({version['width']}x{version['height']})",
                self.image_info(str(output)),
            )

            reduction = 100 * (1 - self.file_size_kb(str(output)) / info["size_kb"])

            print(f"Reduction: {reduction:.2f}%")

        return generated_files


# ===================================================================
# Example usage (mirrors the notebook's final cells)
# ===================================================================
if __name__ == "__main__":
    optimizer = ImageOptimizer(
        image_rel_path=r"images/Product 1/test.jpg",
        output_format="jpeg",
        max_width=333,
        max_height=500,
        target_size_kb=30,
    )

    outputs = optimizer.optimize_image()

    print("\nGenerated Files:")
    for file in outputs:
        print(file)