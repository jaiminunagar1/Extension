from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.image_processing import router as image_router

app = FastAPI(title="Image Optimizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # "http://localhost:3000",
        # "http://127.0.0.1:3000",
        # "chrome-extension://*",
        # "moz-extension://*",
        "*"
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(image_router)


@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000,reload=True)