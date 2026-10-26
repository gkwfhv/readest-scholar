# pdf2zh Next 2.9.0 runtime; Linux amd64 digest for the staging host.
FROM ghcr.io/astral-sh/uv@sha256:5d275ca5f0da33c3368ac8fbb85fafabad023b3b8a7cff39a94ac0baecfd9a50

ENV PYTHONUNBUFFERED=1 UV_HTTP_TIMEOUT=180 UV_HTTP_RETRIES=5
WORKDIR /app
RUN sed -i 's#http://deb.debian.org#https://mirrors.aliyun.com#g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install --no-install-recommends -y \
    libgl1 libglib2.0-0 libxext6 libsm6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*
# BabelDOC 0.6.2 imports BitStream, removed by bitstring 5.0.
RUN --mount=type=cache,target=/root/.cache/uv uv pip install --system \
    --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    'pdf2zh-next==2.9.0' 'bitstring==4.3.1' 'psycopg[binary]==3.3.6' \
    'boto3>=1.35,<2' 'pypdf==6.21.2' \
    && pdf2zh_next --version
ENV HOME=/tmp XDG_CACHE_HOME=/tmp XDG_CONFIG_HOME=/tmp
COPY infra/translation-worker/worker.py /app/worker.py
COPY infra/translation-worker/engine.py /app/engine.py
COPY infra/staging/warmup-translation-assets.py /app/warmup-assets.py
RUN mkdir -p /assets && chown -R 10001:10001 /app /assets
USER 10001:10001
CMD ["python", "/app/worker.py"]
