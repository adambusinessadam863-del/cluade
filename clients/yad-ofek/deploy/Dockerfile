# בונים מתיקיית השורש של הריפו: docker build -f clients/yad-ofek/deploy/Dockerfile -t gateway .
FROM node:22-alpine
WORKDIR /app
# שכבת Claude (אופציונלית): החבילה מותקנת ב-/app/node_modules ונמצאת על ידי ה-gateway
RUN npm install --omit=dev --no-audit --no-fund @anthropic-ai/sdk@0.131.0
COPY automations ./automations
COPY whatsapp-followup ./whatsapp-followup
COPY clients ./clients
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
USER node
EXPOSE 3000
CMD ["node", "automations/gateway/server.js"]
