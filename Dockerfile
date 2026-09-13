FROM node:22.22.1-alpine AS base
WORKDIR /usr/src/wpp-server
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install build dependencies and runtime libraries for sharp
RUN apk update && \
    apk add --no-cache \
    vips \
    vips-dev \
    fftw-dev \
    gcc \
    g++ \
    make \
    libc6-compat \
    pkgconfig \
    python3 \
    && rm -rf /var/cache/apk/*

# To make sure yarn 4 uses node-modules linker
COPY .yarnrc.yml ./

# Copy only package.json to leverage Docker cache
COPY package.json ./
COPY yarn.lock ./

# Enable corepack and prepare yarn 4.12.0
RUN corepack enable && \
    corepack prepare yarn@4.12.0 --activate

# Install dependencies with immutable lockfile
RUN yarn install --immutable

FROM base AS build
WORKDIR /usr/src/wpp-server
COPY . .
RUN yarn install
RUN yarn build

# Panel de administración (React) — se compila aparte, no necesita
# las dependencias nativas del backend (vips/chromium).
FROM node:22.22.1-alpine AS admin-panel-build
WORKDIR /usr/src/wpp-server/admin-panel
COPY admin-panel/package.json admin-panel/package-lock.json ./
RUN npm install
COPY admin-panel/ .
RUN npm run build

FROM build AS runtime
WORKDIR /usr/src/wpp-server/

# Install runtime dependencies (chromium and vips libraries)
RUN apk add --no-cache \
    chromium \
    vips \
    fftw

COPY --from=admin-panel-build /usr/src/wpp-server/admin-panel/dist ./admin-panel/dist

EXPOSE 21465
ENTRYPOINT ["node", "dist/server.js"]
