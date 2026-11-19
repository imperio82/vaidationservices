# ---- build: instala todas las dependencias y compila TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
# mongodb-memory-server solo se usa en pruebas; evita que descargue el binario de MongoDB al instalar
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---- runtime: solo dependencias de producción y el código compilado ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
