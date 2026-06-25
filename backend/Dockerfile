# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

ARG DATABASE_URL=postgresql://postgres:postgres@localhost:5432/slomsdb

ENV DATABASE_URL=${DATABASE_URL}

# Copy package files
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install dependencies without lifecycle scripts
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund || \
    npm install --include=dev --ignore-scripts --no-audit --no-fund

# Copy source code and config files
COPY src ./src
# .swcrc carries the @swc/jest transform config (decorators / NestJS metadata).
# Without it, swc can't parse decorators and every test suite fails to transform.
COPY nest-cli.json tsconfig.json tsconfig.build.json .swcrc ./

# Generate Prisma client first (required before building)
RUN npx prisma generate --schema=./prisma/schema.prisma

# Run tests — build fails if any test fails
RUN npm test -- --passWithNoTests

# Build the NestJS application
RUN npx nest build

# Clean up dev dependencies for smaller image size
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# Playwright stage — installs Chromium into a dedicated layer.
# This stage only re-runs when package*.json changes (i.e. Playwright version bump),
# not on every source code change.
FROM node:20-slim AS playwright

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy only package files and install just enough to get the playwright binary
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

RUN node node_modules/.bin/playwright install chromium --with-deps

# Production stage
# node:20-slim (Debian) is required — Playwright's bundled Chromium headless
# shell is a glibc binary and will not run on Alpine (musl libc).
FROM node:20-slim AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# System utilities: tini (PID-1 signal handling), postgresql-client (migrations)
# Also install Playwright's Chromium system dependencies (libglib-2.0, etc.).
# --with-deps installs them as OS packages in the playwright stage but they live
# in system dirs that COPY /ms-playwright doesn't carry across.
# We mount the playwright stage's node_modules via BuildKit bind so we can run
# `playwright install-deps` without adding a bloated layer to this image.
RUN --mount=type=bind,from=playwright,source=/app,target=/tmp/pw-app \
    apt-get update \
    && apt-get install -y --no-install-recommends tini postgresql-client \
    && node /tmp/pw-app/node_modules/.bin/playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -g 1001 -r nodejs && \
    useradd -u 1001 -r -g nodejs nodejs

# Copy Playwright browsers from the dedicated stage (cached independently of source)
COPY --from=playwright --chown=nodejs:nodejs /ms-playwright /ms-playwright

# Copy production node_modules from builder (includes the playwright package)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Copy remaining built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/dist/src ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./

# Copy and prepare entrypoint
COPY --chown=nodejs:nodejs entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Switch to non-root user
USER nodejs

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
