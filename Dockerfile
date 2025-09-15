FROM oven/bun:latest

WORKDIR /usr/src/app

USER root

RUN apt-get update && apt-get install -y whois netbase && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["bun","--bun", "run", "src/index.ts"]