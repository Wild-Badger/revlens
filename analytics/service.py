import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from analytics.pipeline import PipelineError, cached_prediction, refresh

app = FastAPI(title="RevLens local analytics", docs_url=None, redoc_url=None, openapi_url=None)


def authorize(authorization: str = Header(default="")):
    token = os.environ.get("REV_ANALYTICS_TOKEN", "")
    if len(token) < 32:
        raise HTTPException(503, "Local analytics token is not configured")
    if not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "Local backend authorization required")


class RefreshRequest(BaseModel):
    revision: int = Field(ge=0, le=2147483647)


@app.get("/health")
def health():
    return {"service": "revlens-local-analytics", "version": 1}


@app.get("/v1/prediction", dependencies=[Depends(authorize)])
def prediction():
    try:
        return cached_prediction()
    except PipelineError as error:
        raise HTTPException(409, str(error)) from None
    except Exception:
        raise HTTPException(503, "Local prediction is unavailable; inspect the private analytics log") from None


@app.post("/v1/refresh", dependencies=[Depends(authorize)])
def rebuild(body: RefreshRequest):
    try:
        return refresh(body.revision)
    except PipelineError as error:
        raise HTTPException(409, str(error)) from None
    except Exception:
        raise HTTPException(503, "Analytics refresh failed; data remains saved and retry is available") from None
