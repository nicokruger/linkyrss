# Image for the crawler web app (app.js) and its job workers (jobs.js).
# Build context is src/ because the workers run the Python scripts in ../clusterer.
FROM node:20-bookworm-slim

# chromium for puppeteer, pandoc for page conversion, python for the clusterer.
# chromium cannot use its sandbox when running as root in a container, so
# --no-sandbox goes in the debian chromium wrapper rather than in the app code.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium pandoc python3 python3-venv ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/* \
  && echo 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox"' > /etc/chromium.d/no-sandbox

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# config.json has "python": "python", so put a venv's python on PATH
COPY clusterer/requirements.txt /app/clusterer/requirements.txt
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r /app/clusterer/requirements.txt
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /app/crawler
COPY crawler/package.json crawler/package-lock.json ./
RUN npm ci --omit=dev

COPY clusterer /app/clusterer
COPY crawler /app/crawler

ENV PORT=3000
EXPOSE 3000
CMD ["node", "app.js"]
