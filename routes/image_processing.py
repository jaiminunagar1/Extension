"""
Router for image optimization endpoints.

This is meant to be included into a `main.py` like:

    from fastapi import FastAPI
    from image_router import router as image_router

    app = FastAPI()
    app.include_router(image_router)
"""

import base64
import shutil
import tempfile
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, UploadFile
from image_processing.ImageOptimizer import ImageOptimizer

router = APIRouter(prefix="/images", tags=["Image Optimizer"])

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
}


MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _cleanup(path: str):
    """Remove a temp directory tree."""
    shutil.rmtree(path, ignore_errors=True)


@router.post("/optimize")
async def optimize_image_endpoint(file: UploadFile = File(..., description="Image file to optimize")):
    """
    Accepts only an uploaded image file.
    Runs it through ImageOptimizer using its default settings and
    returns JSON containing each generated variant as a base64 data URI,
    ready to be dropped straight into an <img src="..."> by JS.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {file.content_type}",
        )

    # Work inside an isolated temp directory per request
    work_dir = Path(tempfile.mkdtemp(prefix="img_opt_"))
    input_path = work_dir / file.filename

    try:
        # Save the uploaded file to disk
        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # Use ImageOptimizer with its default configuration
        optimizer = ImageOptimizer()

        # Run the optimization pipeline directly on the uploaded file
        generated_files = optimizer.optimize_image(input_path=str(input_path))

        if not generated_files:
            raise HTTPException(status_code=422, detail="No output files were generated.")

        # Encode every generated variant as a base64 data URI
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
        # Files are already read into memory above, safe to clean up now
        _cleanup(str(work_dir))