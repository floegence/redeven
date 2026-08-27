package desktopbridge

import "testing"

func TestSurfaceAuthorityRoundTrip(t *testing.T) {
	t.Parallel()

	for _, surface := range []StreamSurface{
		StreamSurfaceLocalUI,
		StreamSurfaceRuntimeControl,
		StreamSurfaceGatewayProtocol,
	} {
		authority := surface.Authority()
		if authority == "" {
			t.Fatalf("%q has no authority", surface)
		}
		got, ok := SurfaceFromAuthority(authority)
		if !ok || got != surface {
			t.Fatalf("SurfaceFromAuthority(%q) = %q, %v; want %q, true", authority, got, ok, surface)
		}
	}
}

func TestSurfaceFromAuthorityRejectsUnknownOrPaddedValue(t *testing.T) {
	t.Parallel()

	for _, authority := range []string{"", "unknown", " local-ui ", "LOCAL-UI"} {
		if surface, ok := SurfaceFromAuthority(authority); ok {
			t.Fatalf("SurfaceFromAuthority(%q) = %q, true; want rejection", authority, surface)
		}
	}
}

func TestPlacementHTTP2ContractLimits(t *testing.T) {
	t.Parallel()

	if ProtocolVersion != "redeven-desktop-placement-h2/1" {
		t.Fatalf("ProtocolVersion = %q", ProtocolVersion)
	}
	if MaxConcurrentStreams != 64 {
		t.Fatalf("MaxConcurrentStreams = %d, want 64", MaxConcurrentStreams)
	}
	if StreamReceiveWindowBytes != 256<<10 {
		t.Fatalf("StreamReceiveWindowBytes = %d, want 256 KiB", StreamReceiveWindowBytes)
	}
	if SessionReceiveWindowBytes != 16<<20 {
		t.Fatalf("SessionReceiveWindowBytes = %d, want 16 MiB", SessionReceiveWindowBytes)
	}
}
