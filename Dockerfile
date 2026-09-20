FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=7331 \
    FEHM_HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
COPY docs ./docs
COPY examples ./examples
COPY integrations ./integrations
COPY README.md LICENSE SECURITY.md ./
USER node
EXPOSE 7331
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:7331/api/live >/dev/null || exit 1
CMD ["node", "dist/cli.js", "serve", "/workspace/.fehm/graph.json"]
