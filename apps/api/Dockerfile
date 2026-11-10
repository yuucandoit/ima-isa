FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
COPY packages/types/src ./packages/types/src

RUN bun install

COPY apps/api ./apps/api

WORKDIR /app/apps/api

EXPOSE 3001
CMD ["bun", "run", "start"]
