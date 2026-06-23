FROM node:24-alpine AS base

ARG TURBO_TEAM
ENV TURBO_TEAM=$TURBO_TEAM

ARG TURBO_TOKEN
ENV TURBO_TOKEN=$TURBO_TOKEN

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml .

FROM base AS builder

COPY . .

RUN pnpm install -g turbo

RUN turbo prune deemix-webui --docker

FROM base AS installer

COPY --from=builder /app/out/json/ .

# python3/make/g++ are needed to compile the better-sqlite3 native addon on
# Alpine (musl), which has no prebuilt binary.
RUN apk add --no-cache python3 make g++

RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .

RUN pnpm turbo build --filter=deemix-webui...

FROM ghcr.io/linuxserver/baseimage-alpine:3.24 AS runner

RUN apk add --no-cache nodejs>=24.0.0 openssh-client

COPY --from=installer /app /app

COPY --chown=root:root docker/ /

ENV DEEMIX_DATA_DIR=/config/
ENV DEEMIX_MUSIC_DIR=/downloads/
ENV DEEMIX_SERVER_PORT=6595
ENV DEEMIX_HOST=0.0.0.0
ENV NODE_ENV=production

# Multi-user / proxy-auth + history defaults (override via compose as needed).
ENV DEEMIX_SINGLE_USER=false
ENV DEEMIX_DB_PATH=/config/history.db
ENV ADMIN_GROUP=admins
ENV AUTH_USER_HEADER=Remote-User
ENV AUTH_GROUP_HEADER=Remote-Groups
ENV AUTH_NAME_HEADER=Remote-Name

EXPOSE $DEEMIX_SERVER_PORT
ENTRYPOINT [ "/init" ]
