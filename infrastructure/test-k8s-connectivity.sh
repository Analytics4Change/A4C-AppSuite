#!/usr/bin/env bash

##############################################################################
# Kubernetes Connectivity Test Script
#
# Tests connectivity to the k3s cluster via Cloudflare Tunnel
#
# Usage:
#   ./test-k8s-connectivity.sh [kubeconfig-path]
#
# Examples:
#   ./test-k8s-connectivity.sh                    # Use default ~/.kube/config
#   ./test-k8s-connectivity.sh kubeconfig.yaml    # Use specific kubeconfig
#
# Exit Codes:
#   0 - All tests passed
#   1 - DNS resolution failed
#   2 - HTTPS endpoint not accessible
#   3 - kubectl connection failed
#   4 - kubeconfig file not found
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
K8S_ENDPOINT="k8s.firstovertheline.com"
K8S_URL="https://${K8S_ENDPOINT}"
KUBECONFIG_PATH="${1:-$HOME/.kube/config}"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

##############################################################################
# Helper Functions
##############################################################################

print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_test() {
    echo -e "${YELLOW}Testing:${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((TESTS_PASSED++))
}

print_failure() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

print_info() {
    echo -e "${BLUE}ℹ️  INFO:${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️  WARN:${NC} $1"
}

##############################################################################
# Test Functions
##############################################################################

test_dns_resolution() {
    print_test "DNS resolution for ${K8S_ENDPOINT}"

    if command -v nslookup &> /dev/null; then
        if nslookup ${K8S_ENDPOINT} &> /dev/null; then
            local IP=$(nslookup ${K8S_ENDPOINT} | grep 'Address:' | tail -n1 | awk '{print $2}')
            print_success "DNS resolves to ${IP}"
            return 0
        else
            print_failure "DNS resolution failed"
            print_info "Check Cloudflare DNS configuration"
            return 1
        fi
    elif command -v dig &> /dev/null; then
        if dig +short ${K8S_ENDPOINT} &> /dev/null; then
            local IP=$(dig +short ${K8S_ENDPOINT} | head -n1)
            print_success "DNS resolves to ${IP}"
            return 0
        else
            print_failure "DNS resolution failed"
            print_info "Check Cloudflare DNS configuration"
            return 1
        fi
    elif command -v host &> /dev/null; then
        if host ${K8S_ENDPOINT} &> /dev/null; then
            local IP=$(host ${K8S_ENDPOINT} | grep 'has address' | awk '{print $4}' | head -n1)
            print_success "DNS resolves to ${IP}"
            return 0
        else
            print_failure "DNS resolution failed"
            print_info "Check Cloudflare DNS configuration"
            return 1
        fi
    else
        print_warning "No DNS tools available (nslookup, dig, host)"
        print_info "Skipping DNS test, will try direct connection"
        return 0
    fi
}

test_https_endpoint() {
    print_test "HTTPS endpoint accessibility at ${K8S_URL}"

    if ! command -v curl &> /dev/null; then
        print_failure "curl not found, cannot test HTTPS endpoint"
        return 2
    fi

    # Test connection (expect 401/403 auth error, which proves connectivity)
    local HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" ${K8S_URL}/version 2>&1)

    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "401" ] || [ "$HTTP_CODE" == "403" ]; then
        print_success "Endpoint accessible (HTTP ${HTTP_CODE})"

        # Try to get version info
        local VERSION=$(curl -k -s ${K8S_URL}/version 2>/dev/null | grep -o '"gitVersion":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$VERSION" ]; then
            print_info "Kubernetes version: ${VERSION}"
        fi
        return 0
    elif [ "$HTTP_CODE" == "000" ]; then
        print_failure "Cannot connect to endpoint (connection refused or timeout)"
        print_info "Check that Cloudflare Tunnel is running:"
        print_info "  SSH to k3s host and run: sudo systemctl status cloudflared"
        return 2
    else
        print_failure "Unexpected HTTP code: ${HTTP_CODE}"
        return 2
    fi
}

test_kubectl_config() {
    print_test "Kubeconfig file at ${KUBECONFIG_PATH}"

    if [ ! -f "${KUBECONFIG_PATH}" ]; then
        print_failure "Kubeconfig file not found: ${KUBECONFIG_PATH}"
        print_info "Create kubeconfig using instructions in KUBECONFIG_UPDATE_GUIDE.md"
        return 4
    fi

    print_success "Kubeconfig file exists"

    # Check server URL in kubeconfig
    local SERVER_URL=$(grep -A2 'clusters:' ${KUBECONFIG_PATH} | grep 'server:' | awk '{print $2}' | head -n1)
    print_info "Server URL: ${SERVER_URL}"

    if [[ "${SERVER_URL}" == *"${K8S_ENDPOINT}"* ]]; then
        print_success "Kubeconfig points to public endpoint"
    elif [[ "${SERVER_URL}" == *"127.0.0.1"* ]] || [[ "${SERVER_URL}" == *"localhost"* ]] || [[ "${SERVER_URL}" == *"192.168."* ]]; then
        print_warning "Kubeconfig points to private endpoint: ${SERVER_URL}"
        print_info "Update kubeconfig to use: ${K8S_URL}"
        print_info "See KUBECONFIG_UPDATE_GUIDE.md for instructions"
    fi

    return 0
}

test_kubectl_connection() {
    print_test "kubectl connection to cluster"

    if ! command -v kubectl &> /dev/null; then
        print_failure "kubectl not found, cannot test cluster connection"
        print_info "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
        return 3
    fi

    # Set kubeconfig for this test
    export KUBECONFIG="${KUBECONFIG_PATH}"

    # Test cluster-info (captures errors)
    if kubectl cluster-info &> /tmp/kubectl-test.log; then
        print_success "kubectl successfully connected to cluster"

        # Show cluster info
        local CLUSTER_INFO=$(kubectl cluster-info | head -n1)
        print_info "${CLUSTER_INFO}"

        # Try to get nodes
        if kubectl get nodes &> /dev/null; then
            local NODE_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | wc -l)
            print_success "Can access cluster resources (${NODE_COUNT} nodes)"
        else
            print_warning "Connected but cannot list nodes (check RBAC permissions)"
        fi

        rm -f /tmp/kubectl-test.log
        return 0
    else
        print_failure "kubectl connection failed"

        # Parse error message
        if grep -q "certificate" /tmp/kubectl-test.log; then
            print_info "Certificate validation error detected"
            print_info "Try adding 'insecure-skip-tls-verify: true' to kubeconfig"
        elif grep -q "connection refused" /tmp/kubectl-test.log; then
            print_info "Connection refused - check Cloudflare Tunnel is running"
        elif grep -q "no such host" /tmp/kubectl-test.log; then
            print_info "DNS resolution failed - check DNS configuration"
        elif grep -q "Unauthorized" /tmp/kubectl-test.log; then
            print_info "Authentication failed - check client certificates in kubeconfig"
        fi

        # Show first error line
        local ERROR=$(head -n1 /tmp/kubectl-test.log)
        print_info "Error: ${ERROR}"

        rm -f /tmp/kubectl-test.log
        return 3
    fi
}

test_cloudflared_service() {
    print_test "Cloudflare Tunnel service status (requires SSH to k3s host)"

    print_info "This test requires SSH access to the k3s host machine"
    print_info "To manually check: ssh <k3s-host> 'sudo systemctl status cloudflared'"
    print_info "Skipping automated check..."

    return 0
}

##############################################################################
# Main Test Execution
##############################################################################

main() {
    print_header "🌐 Kubernetes Cluster Connectivity Test"

    echo "Testing connectivity to: ${K8S_URL}"
    echo "Using kubeconfig: ${KUBECONFIG_PATH}"

    # Run tests
    test_dns_resolution || true
    echo ""

    test_https_endpoint || true
    echo ""

    test_kubectl_config || true
    echo ""

    test_kubectl_connection || true
    echo ""

    test_cloudflared_service || true
    echo ""

    # Summary
    print_header "📊 Test Summary"

    local TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
    echo "Total tests: ${TOTAL_TESTS}"
    echo -e "Passed: ${GREEN}${TESTS_PASSED}${NC}"
    echo -e "Failed: ${RED}${TESTS_FAILED}${NC}"

    if [ $TESTS_FAILED -eq 0 ]; then
        echo ""
        print_success "All tests passed! ✨"
        echo ""
        echo "Your cluster is accessible from this machine."
        echo "GitHub Actions should be able to deploy using this configuration."
        return 0
    else
        echo ""
        print_failure "Some tests failed"
        echo ""
        echo "🔧 Troubleshooting steps:"
        echo "  1. Review failed tests above"
        echo "  2. Check KUBECONFIG_UPDATE_GUIDE.md for detailed instructions"
        echo "  3. Verify Cloudflare Tunnel is running on k3s host"
        echo "  4. Test DNS: nslookup ${K8S_ENDPOINT}"
        echo "  5. Test HTTPS: curl -k ${K8S_URL}/version"
        echo ""
        return 1
    fi
}

# Run main function
main "$@"
