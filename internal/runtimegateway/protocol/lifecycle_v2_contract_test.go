package protocol_test

import (
	"testing"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestRuntimeLifecycleV2ProtocolBaseline(t *testing.T) {
	if gatewayprotocol.Version != "redeven-gateway-v2" {
		t.Fatalf("Gateway protocol version = %q, want redeven-gateway-v2", gatewayprotocol.Version)
	}
	if runtimeservice.ProtocolVersion != "redeven-runtime-v2" {
		t.Fatalf("Runtime Service protocol version = %q, want redeven-runtime-v2", runtimeservice.ProtocolVersion)
	}
	if epoch := runtimeservice.CurrentCompatibilityContract().CompatibilityEpoch; epoch != 9 {
		t.Fatalf("Runtime Service compatibility epoch = %d, want 9", epoch)
	}
}
