FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libxml2-dev libxslt1-dev curl \
    && rm -rf /var/lib/apt/lists/*

ARG INSTALL_AI=false

COPY requirements.txt requirements-ai.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && if [ "$INSTALL_AI" = "true" ]; then pip install -r requirements-ai.txt; fi

COPY . .

CMD ["python", "-m", "main"]
