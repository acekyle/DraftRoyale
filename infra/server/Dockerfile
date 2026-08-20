# Infinite Arena — control-plane room server
# Build from the repo root:  docker build -f infra/server/Dockerfile -t arena-server .
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY tools ./tools
COPY content ./content
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --ignore-scripts

ENV NODE_ENV=production
ENV ARENA_PORT=8790
# Optional: set ANTHROPIC_API_KEY via your platform's secret store (never bake it
# into the image) to enable LLM-backed character/wildcard compilation.

EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:8790/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "services/control-plane/src/main.ts"]
