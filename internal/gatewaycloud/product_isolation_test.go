package gatewaycloud

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"testing"

	"github.com/floegence/redeven/internal/gatewayegress"
)

// This fixture runs the real Cloud synchronization and forwarding service in
// Docker. Only the test binary permits the private addresses of the Cloud test
// stack. Production binaries have no flag or environment override for this.
func TestGatewayCloudProductProcess(t *testing.T) {
	root := os.Getenv("REDEVEN_GATEWAY_PRODUCT_TEST_STATE")
	if root == "" {
		t.Skip("isolated product qualification only")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := startGateway(ctx, root, slog.Default(), gatewayegress.Options{AllowPrivateDestinations: true}); err != nil {
		t.Fatal(err)
	}
	<-ctx.Done()
}
