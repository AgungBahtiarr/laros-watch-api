FROM oven/bun:latest AS builder
WORKDIR /usr/src/app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:latest AS release
WORKDIR /usr/src/app

USER root

RUN apt-get update && apt-get install -y whois netbase && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/app .

EXPOSE 3000
CMD ["bun","--bun", "run", "src/index.ts"]
