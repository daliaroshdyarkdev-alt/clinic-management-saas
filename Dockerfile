# Web app image (Next.js). Build:
#   docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... -t clinic-web .
# Secrets (SUPABASE_SECRET_KEY, WHATSAPP_*, BILLING_*) are provided at run
# time by the platform's secret store, never baked into the image.
FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/next.config.ts ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/ar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
