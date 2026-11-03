# Image for the crawler web app (app.js) and its job workers (jobs.js).
# Build context is src/ because the workers run the Python scripts in ../clusterer.
FROM node:20-bookworm-slim

# chromium for puppeteer, pandoc for page conversion, python for the clusterer
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium pandoc python3 python3-venv ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_NO_SANDBOX=1

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
