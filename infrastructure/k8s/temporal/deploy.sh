#!/bin/bash
# Temporal Deployment Script
# Run this script to deploy Temporal to your k3s cluster

set -e  # Exit on error

echo "==== Temporal Deployment for A4C ===="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}Error: kubectl not found. Please install kubectl first.${NC}"
    exit 1
fi

# Check if helm is available
if ! command -v helm &> /dev/null; then
    echo -e "${RED}Error: helm not found. Please install helm first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} kubectl and helm found"
echo ""

# Step 1: Create namespace
echo "Step 1: Creating Temporal namespace..."
kubectl apply -f namespace.yaml
echo -e "${GREEN}✓${NC} Namespace created"
echo ""

# Step 2: Check if secrets.yaml exists
if [ ! -f "secrets.yaml" ]; then
    echo -e "${YELLOW}⚠${NC}  secrets.yaml not found. Creating from template..."
    cp secrets-template.yaml secrets.yaml

    echo ""
    echo -e "${YELLOW}ACTION REQUIRED:${NC} Please edit secrets.yaml and fill in the following credentials:"
    echo ""
    echo "1. CLOUDFLARE_API_TOKEN"
    echo "   Get from: ~/.cloudflared/cert.pem (already decoded for you)"
    echo "   Value: X9bodZjGqEO4gimERgD9Q9TfMiCuEOORlr7seS6W"
    echo ""
    echo "2. CLOUDFLARE_ZONE_ID"
    echo "   Get from: ~/.cloudflared/cert.pem (already decoded for you)"
    echo "   Value: 538e5229b00f5660508a1c7fcd097f97"
    echo ""
    echo "3. ZITADEL_SERVICE_USER_ID"
    echo "   Get from: Zitadel Console → Service Users"
    echo "   URL: https://analytics4change-zdswvg.us1.zitadel.cloud"
    echo ""
    echo "4. ZITADEL_SERVICE_USER_SECRET"
    echo "   Get from: Zitadel Console → Service Users → View Secret"
    echo ""
    echo "5. SUPABASE_SERVICE_ROLE_KEY"
    echo "   Get from: Supabase Dashboard → Settings → API"
    echo "   URL: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/settings/api"
    echo ""
    echo -e "${YELLOW}Press ENTER when you've filled in all credentials...${NC}"
    read -r
fi

# Step 3: Apply secrets
echo "Step 2: Creating Kubernetes secrets..."
kubectl apply -f secrets.yaml

# Verify secrets were created
if kubectl get secret -n temporal temporal-credentials &> /dev/null; then
    echo -e "${GREEN}✓${NC} Secrets created successfully"
else
    echo -e "${RED}✗${NC} Failed to create secrets"
    exit 1
fi
echo ""

# Step 4: Apply ConfigMap
echo "Step 3: Creating ConfigMap (development environment)..."
kubectl apply -f configmap-dev.yaml
echo -e "${GREEN}✓${NC} ConfigMap created"
echo ""

# Step 5: Add Temporal Helm repo
echo "Step 4: Adding Temporal Helm repository..."
helm repo add temporalio https://go.temporal.io/helm-charts &> /dev/null || true
helm repo update &> /dev/null
echo -e "${GREEN}✓${NC} Helm repository added"
echo ""

# Step 6: Install Temporal
echo "Step 5: Installing Temporal..."
echo "This may take 3-5 minutes..."
echo ""

helm install temporal temporalio/temporal \
  --namespace temporal \
  --values values.yaml \
  --wait \
  --timeout 10m

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓${NC} Temporal installed successfully!"
else
    echo ""
    echo -e "${RED}✗${NC} Temporal installation failed"
    echo "Check logs with: kubectl logs -n temporal -l app=temporal-server"
    exit 1
fi
echo ""

# Step 7: Verify deployment
echo "Step 6: Verifying deployment..."
echo ""

kubectl get pods -n temporal

echo ""
echo -e "${GREEN}==== Deployment Complete! ====${NC}"
echo ""
echo "Next steps:"
echo "1. Access Temporal UI:"
echo "   kubectl port-forward -n temporal svc/temporal-ui 8080:8080"
echo "   Then open: http://localhost:8080"
echo ""
echo "2. Check pod status:"
echo "   kubectl get pods -n temporal"
echo ""
echo "3. View logs:"
echo "   kubectl logs -n temporal -l app=temporal-server"
echo ""
echo "4. Verify secrets (without exposing values):"
echo "   kubectl get secret -n temporal temporal-credentials"
echo ""
