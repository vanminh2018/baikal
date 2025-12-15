FROM node:24-alpine AS builder
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && \
    npm cache clean --force



FROM node:24-alpine AS production
LABEL maintainer="minhbv" \
      version="1.0.0" \
      description="Baikal API for automatic user creation"
ENV NODE_ENV=production \
    PORT=3000
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
WORKDIR /app
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .
USER nodejs
EXPOSE 3000/tcp
CMD ["node", "server.js"]
