#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your own Google Cloud project id before running.}"

REGION="${REGION:-europe-west2}"
SERVICE_NAME="${SERVICE_NAME:-content-radar}"
ARTIFACT_REPO="${ARTIFACT_REPO:-content-radar-images}"
GITHUB_REPO="${GITHUB_REPO:-askerzade135/AI-Content-Funnel}"
TARGET_BRANCH="${TARGET_BRANCH:-feature/content-radar-mvp1}"
POOL_ID="${POOL_ID:-github-pool}"
PROVIDER_ID="${PROVIDER_ID:-github-provider}"

DEPLOYER_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="content-radar-runner@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Using project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

echo "Enabling APIs..."
gcloud services enable   run.googleapis.com   artifactregistry.googleapis.com   iamcredentials.googleapis.com   sts.googleapis.com   secretmanager.googleapis.com   firestore.googleapis.com

if ! gcloud artifacts repositories describe "${ARTIFACT_REPO}" --location="${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${ARTIFACT_REPO}"     --repository-format=docker     --location="${REGION}"     --description="Docker images for Content Radar"
fi

if ! gcloud iam service-accounts describe "${DEPLOYER_SA}" >/dev/null 2>&1; then
  gcloud iam service-accounts create github-deployer     --display-name="GitHub Actions Deployer"
fi

if ! gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1; then
  gcloud iam service-accounts create content-radar-runner     --display-name="Content Radar Cloud Run Runtime"
fi

echo "Granting deployer permissions..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}"   --member="serviceAccount:${DEPLOYER_SA}"   --role="roles/run.developer"   --condition=None >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}"   --member="serviceAccount:${DEPLOYER_SA}"   --role="roles/artifactregistry.writer"   --condition=None >/dev/null

gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}"   --member="serviceAccount:${DEPLOYER_SA}"   --role="roles/iam.serviceAccountUser" >/dev/null

echo "Granting runtime Firestore permissions..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}"   --member="serviceAccount:${RUNTIME_SA}"   --role="roles/datastore.user"   --condition=None >/dev/null

echo "Creating Secret Manager entries..."
for SECRET in GEMINI_API_KEY YOUTUBE_API_KEY SUPADATA_API_KEY CHOCODATA_API_KEY; do
  if ! gcloud secrets describe "${SECRET}" >/dev/null 2>&1; then
    gcloud secrets create "${SECRET}" --replication-policy=automatic >/dev/null
  fi

  gcloud secrets add-iam-policy-binding "${SECRET}"     --member="serviceAccount:${RUNTIME_SA}"     --role="roles/secretmanager.secretAccessor" >/dev/null
done

echo "Creating Firestore database if needed..."
if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create     --database="(default)"     --location="${REGION}"     --type=firestore-native
fi

echo "Configuring Workload Identity Federation..."
if ! gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}"     --location=global     --display-name="GitHub Actions Pool"
fi

if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}"   --location=global   --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}"     --location=global     --workload-identity-pool="${POOL_ID}"     --display-name="GitHub OIDC Provider"     --issuer-uri="https://token.actions.githubusercontent.com"     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.actor=assertion.actor"     --attribute-condition="assertion.repository=='${GITHUB_REPO}' && assertion.ref=='refs/heads/${TARGET_BRANCH}'"
fi

POOL_RESOURCE="$(gcloud iam workload-identity-pools describe "${POOL_ID}"   --location=global   --format='value(name)')"

PROVIDER_RESOURCE="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}"   --location=global   --workload-identity-pool="${POOL_ID}"   --format='value(name)')"

gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}"   --role="roles/iam.workloadIdentityUser"   --member="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository/${GITHUB_REPO}" >/dev/null

echo "Bootstrapping a public Cloud Run service so later revisions inherit public access..."
gcloud run deploy "${SERVICE_NAME}"   --project="${PROJECT_ID}"   --region="${REGION}"   --image="us-docker.pkg.dev/cloudrun/container/hello"   --service-account="${RUNTIME_SA}"   --allow-unauthenticated   --quiet

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}"   --project="${PROJECT_ID}"   --region="${REGION}"   --format='value(status.url)')"

cat <<EOF

GCP infrastructure is ready.

Add these GitHub Actions Variables:
  GCP_PROJECT_ID=${PROJECT_ID}
  GCP_REGION=${REGION}
  CLOUD_RUN_SERVICE=${SERVICE_NAME}
  ARTIFACT_REPO=${ARTIFACT_REPO}
  CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT=${RUNTIME_SA}
  FIREBASE_PROJECT_ID=${PROJECT_ID}
  FIRESTORE_DATABASE_ID=(default)

Add these GitHub Actions Secrets:
  GCP_WORKLOAD_IDENTITY_PROVIDER=${PROVIDER_RESOURCE}
  GCP_SERVICE_ACCOUNT=${DEPLOYER_SA}

You still need to:
  1. Add secret VALUES to Secret Manager for GEMINI_API_KEY, YOUTUBE_API_KEY, SUPADATA_API_KEY, CHOCODATA_API_KEY.
  2. Add Firebase to this project, enable Google sign-in, create a Web App, and copy its public config into the VITE_FIREBASE_* GitHub Variables.
  3. Add the Cloud Run domain to Firebase Authentication Authorized domains.

Bootstrap Cloud Run URL:
  ${SERVICE_URL}
EOF
