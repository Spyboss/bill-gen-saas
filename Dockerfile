# Build stage
FROM node:18-alpine AS build

# Set working directory
WORKDIR /build

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies)
RUN npm install

# Explicitly add multer
RUN npm install multer@1.4.5-lts.1

# Production stage
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production
RUN npm install multer@1.4.5-lts.1

# Copy node_modules from build stage to ensure all dependencies are included
COPY --from=build /build/node_modules /app/node_modules

# Copy the application files
COPY src ./src
COPY assets ./assets
COPY templates ./templates
COPY tsconfig.json ./tsconfig.json
COPY wrangler.toml ./wrangler.toml

# Create necessary directories
RUN mkdir -p assets/certificates assets/fonts data uploads

# Environment variables (these will be overridden by Railway environment variables)
ENV PORT=3000
ENV NODE_ENV=production
ENV CORS_ORIGIN=https://tmr-bill-generator.pages.dev
# Force IPv4 in Node.js
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
# Use direct IPv4 connection
ENV DATABASE_URL=postgres://postgres:p*BQQ44ue-PfE2R@3.111.105.85:5432/postgres
ENV SUPABASE_SSL_ENABLED=true
ENV TEMPLATES_DIR=./templates
ENV FRONTEND_URL=https://tmr-bill-generator.pages.dev
ENV JWT_SECRET=your-production-secret

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

EXPOSE 3000

# Start command with proper signal handling
CMD ["node", "src/index.js"]