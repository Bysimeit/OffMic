FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine

RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=48085

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY healthcheck.mjs ./

USER node

EXPOSE 48085

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "healthcheck.mjs"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
