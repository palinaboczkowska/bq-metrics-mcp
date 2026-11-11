#!/bin/sh
# One-time setup: dataset, tables and a read-only service account for the server.
# Usage: PROJECT=my-project ./scripts/setup-bigquery.sh
set -e
PROJECT=${PROJECT:?set PROJECT}
DATASET=${DATASET:-shop_demo}
SA=metrics-mcp-reader
cd "$(dirname "$0")/.."

npm run generate
bq --project_id="$PROJECT" mk --dataset --location=EU --description="Synthetic demo data for bq-metrics-mcp" "$PROJECT:$DATASET" || true
bq --project_id="$PROJECT" load --replace --source_format=NEWLINE_DELIMITED_JSON "$DATASET.products" data/products.ndjson sku:STRING,name:STRING,category:STRING
bq --project_id="$PROJECT" load --replace --source_format=NEWLINE_DELIMITED_JSON "$DATASET.orders" data/orders.ndjson order_id:STRING,order_date:DATE,market:STRING,channel:STRING
bq --project_id="$PROJECT" load --replace --source_format=NEWLINE_DELIMITED_JSON "$DATASET.order_lines" data/order_lines.ndjson order_id:STRING,sku:STRING,quantity:INT64,unit_price_sek:FLOAT64,discount_sek:FLOAT64
bq --project_id="$PROJECT" load --replace --source_format=NEWLINE_DELIMITED_JSON "$DATASET.ad_spend" data/ad_spend.ndjson date:DATE,market:STRING,ad_channel:STRING,spend_sek:FLOAT64

# Least privilege: read this one dataset and run query jobs, nothing else.
gcloud iam service-accounts create "$SA" --project="$PROJECT" --display-name="bq-metrics-mcp (read-only)" || true
EMAIL="$SA@$PROJECT.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$EMAIL" --role=roles/bigquery.jobUser --condition=None >/dev/null
bq --project_id="$PROJECT" show --format=prettyjson "$PROJECT:$DATASET" > /tmp/ds.json
python3 - "$EMAIL" <<'PY'
import json, sys
d = json.load(open("/tmp/ds.json"))
entry = {"role": "READER", "userByEmail": sys.argv[1]}
if entry not in d.get("access", []): d.setdefault("access", []).append(entry)
json.dump(d, open("/tmp/ds.json", "w"))
PY
bq --project_id="$PROJECT" update --source /tmp/ds.json "$PROJECT:$DATASET"
echo "Done. Dataset $PROJECT:$DATASET, reader $EMAIL"
