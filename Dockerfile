# syntax=docker/dockerfile:1
# sigint-srbija map server. The database is not in the image: mount the
# directory holding sigint.sqlite (writable, SQLite keeps WAL files next to it)
# and point SIGINT_DB at the file:
#   docker run -v /data/sigint:/data/sigint -e SIGINT_DB=/data/sigint/sigint.sqlite -p 3000:3000 ghcr.io/nemanjan00/sigint-srbija
FROM node:26-slim

ENV NODE_ENV=production \
    PORT=3000 \
    SIGINT_DB=/data/sigint/sigint.sqlite

WORKDIR /app

COPY package.json yarn.lock ./
# Node >= 25 images ship without yarn. Dev dependencies (esbuild, Tailwind)
# are only needed for the page build and are pruned after it.
RUN npm install -g yarn@1 && yarn install --frozen-lockfile --production=false

COPY . .

RUN yarn build && yarn install --frozen-lockfile --production && yarn cache clean

EXPOSE 3000
VOLUME ["/data/sigint"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "src/index.js"]
