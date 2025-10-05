# syntax=docker/dockerfile:1

FROM node:20-bullseye AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bullseye AS builder
WORKDIR /app
ENV NEXT_DISABLE_LIGHTNINGCSS=1 LIGHTNINGCSS_DISABLE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bullseye AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_DISABLE_LIGHTNINGCSS=1 \
    LIGHTNINGCSS_DISABLE=1 \
    PORT=3000
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/biome.json ./biome.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/python ./python
COPY --from=builder /app/next-env.d.ts ./next-env.d.ts
COPY --from=builder /app/bun.lock ./bun.lock
EXPOSE 3000
CMD ["npm", "run", "start"]
