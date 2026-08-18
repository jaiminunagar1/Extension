"""
Router for image optimization endpoints.
"""

import base64
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Form, HTTPException
from PIL import Image, UnidentifiedImageError
from image_processing.ImageOptimizer import ImageOptimizer
from image_processing.BiRefNetBackgroundRemover import BiRefNetBackgroundRemover

router = APIRouter(prefix="/images", tags=["Image Optimizer"])
background_remover = BiRefNetBackgroundRemover()
optimizer = ImageOptimizer()

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
}

# Headers that don't actually tell us anything useful
GENERIC_CONTENT_TYPES = {"application/octet-stream", "binary/octet-stream", ""}

MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}

# Pillow format name -> our mime type
PIL_FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "BMP": "image/bmp",
    "TIFF": "image/tiff",
}

MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024  # 25 MB safety cap


def _cleanup(path: str):
    shutil.rmtree(path, ignore_errors=True)


def _filename_from_uri(uri: str, fallback_ext: str = ".bin") -> str:
    name = Path(urlparse(uri).path).name
    print(f"Extracted filename from URI: {name}")
    print(f"path={urlparse(uri).path}")
    if name and Path(name).suffix.lower() in MIME_BY_SUFFIX:
        return name
    return f"downloaded{fallback_ext}"


def _detect_real_mime(path: Path) -> str | None:
    """Open the file and ask Pillow what it actually is, regardless of headers."""
    try:
        with Image.open(path) as img:
            img.verify()  # cheap integrity check
        with Image.open(path) as img:  # verify() closes the file, reopen
            fmt = img.format
            print(f"Detected image format: {fmt}")
        return PIL_FORMAT_TO_MIME.get(fmt)
    except (UnidentifiedImageError, OSError):
        return None


@router.post("/optimize")
async def optimize_image_endpoint(fileuri: str = Form(..., description="URL of the image to optimize")):
    work_dir = Path(tempfile.mkdtemp(prefix="img_opt_"))

    try:
        # --- Fetch the remote file ---
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                async with client.stream("GET", fileuri) as resp:
                    resp.raise_for_status()

                    header_content_type = resp.headers.get("content-type", "").split(";")[0].strip()
                    print(f"header_content_type={header_content_type}")

                    # Tentative filename/path — may be renamed after we sniff the real type
                    temp_name = _filename_from_uri(fileuri)
                    input_path = work_dir / temp_name

                    total = 0
                    with open(input_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=1024 * 64):
                            total += len(chunk)
                            if total > MAX_DOWNLOAD_BYTES:
                                raise HTTPException(status_code=413, detail="Remote file too large.")
                            f.write(chunk)

        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to fetch file (status {e.response.status_code}): {fileuri}",
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch file: {e}")

        # --- Determine the real content type ---
        if header_content_type in ALLOWED_CONTENT_TYPES:
            content_type = header_content_type
        else:
            # Header was missing/generic (e.g. application/octet-stream) — sniff instead
            content_type = _detect_real_mime(input_path)

        if content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported or undetectable content type "
                       f"(header said: {header_content_type or 'none'}).",
            )

        # Rename to match the detected type so downstream code/suffix logic is correct
        # correct_ext = next(ext for ext, mt in MIME_BY_SUFFIX.items() if mt == content_type)
        # if input_path.suffix.lower() != correct_ext:
        #     new_path = input_path.with_suffix(correct_ext)
        #     input_path.rename(new_path)
        #     input_path = new_path

        output_path = input_path.with_name(f"{input_path.stem}_wbg.png")
        
        background_remover.process(image_path=input_path, output_path=output_path)

        # --- Run the optimizer ---
        
        generated_files = optimizer.optimize_image(input_path=str(output_path))

        if not generated_files:
            raise HTTPException(status_code=422, detail="No output files were generated.")

        images = []
        for f in generated_files:
            f_path = Path(f)
            mime = MIME_BY_SUFFIX.get(f_path.suffix.lower(), "application/octet-stream")

            with open(f_path, "rb") as fh:
                encoded = base64.b64encode(fh.read()).decode("utf-8")

            images.append(
                {
                    "filename": f_path.name,
                    "mime_type": mime,
                    "size_kb": round(f_path.stat().st_size / 1024, 2),
                    "data_uri": f"data:{mime};base64,{encoded}",
                }
            )

        return {"count": len(images), "images": images}

    finally:
        _cleanup(str(work_dir))