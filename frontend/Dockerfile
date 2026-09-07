FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

# NEXT_PUBLIC_* values are inlined into the bundle at BUILD time, so each
# Render service builds its own image from this same Dockerfile. Render passes
# a service's env vars in as build args automatically. All four are public,
# non-sensitive values — never add a secret here, it would end up in the image.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# creator | admin | all — which surface this image serves (see src/lib/app-mode.ts)
ARG NEXT_PUBLIC_APP_MODE
ENV NEXT_PUBLIC_APP_MODE=$NEXT_PUBLIC_APP_MODE
# Absolute URL of the other app, for the cross-app sidebar links
ARG NEXT_PUBLIC_ADMIN_URL
ENV NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
ARG NEXT_PUBLIC_CREATOR_URL
ENV NEXT_PUBLIC_CREATOR_URL=$NEXT_PUBLIC_CREATOR_URL

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3100
ENV PORT=3100
CMD ["node", "server.js"]
