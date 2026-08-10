from fastapi import FastAPI
from routes.image_processing import router as image_router
 
app = FastAPI(title="Image Optimizer API")
 
app.include_router(image_router)
 
 
@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000,reload=True)