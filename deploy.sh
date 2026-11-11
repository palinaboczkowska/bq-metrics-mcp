#!/bin/sh
# Deploys to Cloud Run as a private service: only callers with roles/run.invoker can reach it.
set -e
cd "$(dirname "$0")"
PROJECT=${PROJECT:-bq-metrics-mcp-pb}
gcloud run deploy bq-metrics-mcp --project "$PROJECT" \
  --source . \
  --region europe-north1 \
  --no-allow-unauthenticated \
  --service-account "metrics-mcp-reader@$PROJECT.iam.gserviceaccount.com" \
  --set-env-vars "BQ_DATASET=$PROJECT.shop_demo,GOOGLE_CLOUD_PROJECT=$PROJECT,BQ_LOCATION=EU,BQ_MAX_BYTES=104857600" \
  --min-instances 0 --max-instances 2 \
  --memory 512Mi \
  --quiet
echo "Use it locally: gcloud run services proxy bq-metrics-mcp --project $PROJECT --region europe-north1 --port 8080  ->  http://localhost:8080/mcp"
