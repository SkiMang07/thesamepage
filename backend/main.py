from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routes import direct_reports, one_on_ones

app = FastAPI(title="The Same Page API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(direct_reports.router, prefix="/api/direct-reports", tags=["direct-reports"])
app.include_router(one_on_ones.router, prefix="/api/one-on-ones", tags=["one-on-ones"])


@app.get("/health")
async def health():
    return {"status": "ok", "environment": settings.ENVIRONMENT}
