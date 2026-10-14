from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.router import api_router
from app.services.job_manager import job_manager
from app.core.logging import logger

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing VisionGuard backend service...")
    job_manager.initialize()
    logger.info(f"VisionGuard backend started on {settings.HOST}:{settings.PORT}")
    yield
    logger.info("Shutting down VisionGuard backend service...")
    await job_manager.shutdown()

app = FastAPI(
    title="VisionGuard AI Backend",
    description="Local computer-vision backend for VisionGuard traffic video analysis",
    version="1.0.0",
    lifespan=lifespan
)

# Explicitly allowed local development origins
ALLOWED_ORIGINS: List[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

ALLOWED_METHODS: List[str] = [
    "GET",
    "POST",
    "DELETE",
    "OPTIONS",
    "PUT",
    "PATCH",
    "HEAD",
]

ALLOWED_HEADERS: List[str] = [
    "Authorization",
    "Content-Type",
    "Accept",
    "Origin",
    "X-Requested-With",
    "apikey",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
]

def is_allowed_origin(origin: Optional[str]) -> bool:
    if not origin:
        return False
    clean = origin.rstrip("/")
    return clean in ALLOWED_ORIGINS

def get_cors_headers_for_origin(origin: Optional[str]) -> dict:
    if is_allowed_origin(origin):
        return {
            "Access-Control-Allow-Origin": origin.rstrip("/"),
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": ", ".join(ALLOWED_METHODS),
            "Access-Control-Allow-Headers": ", ".join(ALLOWED_HEADERS),
            "Vary": "Origin",
        }
    return {}

# 1. Custom middleware to ensure CORS headers on all responses, including exceptions
@app.middleware("http")
async def ensure_cors_headers_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.error(f"Unhandled exception caught in HTTP middleware: {exc}", exc_info=True)
        cors_headers = get_cors_headers_for_origin(origin)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Internal server error: {str(exc)}"},
            headers=cors_headers
        )

    if is_allowed_origin(origin):
        if "access-control-allow-origin" not in response.headers:
            response.headers["Access-Control-Allow-Origin"] = origin.rstrip("/")
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"

    return response

# 2. Standard FastAPI CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=ALLOWED_METHODS,
    allow_headers=ALLOWED_HEADERS,
    expose_headers=["*"],
    max_age=600,
)

# 3. Explicit exception handlers to guarantee CORS headers on error responses
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global exception handler caught: {exc}", exc_info=True)
    origin = request.headers.get("origin")
    cors_headers = get_cors_headers_for_origin(origin)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": f"Internal server error: {str(exc)}"},
        headers=cors_headers
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    origin = request.headers.get("origin")
    cors_headers = get_cors_headers_for_origin(origin)
    headers = {**cors_headers, **(exc.headers or {})}
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=headers
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    origin = request.headers.get("origin")
    cors_headers = get_cors_headers_for_origin(origin)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
        headers=cors_headers
    )

# Mount API v1 router
app.include_router(api_router, prefix="/api/v1")

@app.get("/")
async def root():
    return {
        "service": "VisionGuard AI Backend",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/v1/health"
    }
