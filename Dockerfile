# ---- build the React UI ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/wmhunter96/Butterfly
LABEL org.opencontainers.image.description="Self-hosted, Monarch-style finance dashboard for Actual Budget"
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/config
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
RUN mkdir -p /config
VOLUME /config
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
