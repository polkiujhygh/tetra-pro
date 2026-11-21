FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY worker.js hooks.mjs loader.mjs server.js ./
COPY shims ./shims

ENV PORT=3000 \
    KV_PATH=/app/data/kv.json

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "--import", "./hooks.mjs", "server.js"]
