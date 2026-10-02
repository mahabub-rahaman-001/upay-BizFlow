# BizFlow AI service (FastAPI). Runs the forecast, anomaly and Bangla language-AI endpoints.
# libgomp1 is LightGBM's OpenMP runtime; without it the model import fails at startup.
FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so a code change does not re-run the slow wheel build.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data
COPY models ./models

EXPOSE 8000

# A healthcheck so `docker compose up` can report when the service is actually ready.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD curl -fsS http://localhost:8000/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
