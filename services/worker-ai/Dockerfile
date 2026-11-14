FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# ffmpeg + fonts untuk render klip 9:16 (libass tersedia di Debian, jadi
# caption .ass bisa dibakar langsung tanpa fallback Pillow).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential libxml2-dev libxslt1-dev curl \
        ffmpeg fonts-dejavu-core adb \
    && rm -rf /var/lib/apt/lists/*

ARG INSTALL_AI=false
ARG INSTALL_CLIP=false

COPY requirements.txt requirements-ai.txt requirements-clipping.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && if [ "$INSTALL_AI" = "true" ]; then pip install -r requirements-ai.txt; fi \
    && if [ "$INSTALL_CLIP" = "true" ]; then pip install -r requirements-clipping.txt; fi

COPY . .

CMD ["python", "-m", "main"]
