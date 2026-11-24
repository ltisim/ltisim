# LTISim — one image serves the API, the LTI endpoints, and the built
# frontend (Express static + SPA fallback, see backend/src/server.js).
#
# Build:  docker build -t ltisim .

# ---- Stage 1: frontend build ---------------------------------------------
FROM node:20-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src backend/src
COPY backend/db backend/db
COPY --from=frontend /build/dist frontend/dist

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]
