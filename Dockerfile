# Build the web app
FROM node:24-alpine AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Run the API server, which also serves the built web app
FROM node:24-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
