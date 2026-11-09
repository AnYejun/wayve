# WAYVE — multi-stage: build the SPA, then a slim runtime that runs server/index.ts via Node type stripping.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
ARG RELEASE=dev
ENV RELEASE=${RELEASE}
# Runs as root on purpose: the Fly volume at /app/data is root-owned.
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "--no-warnings", "--import", "./server/early.js", "server/index.ts"]
