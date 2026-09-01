package managedwebservice

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestManagedTransferProgressReporterSeparatesLayersBytesAndSmoothsRate(t *testing.T) {
	t.Parallel()
	base := time.Unix(100, 0)
	times := []time.Time{base, base.Add(time.Second), base.Add(1200 * time.Millisecond), base.Add(2 * time.Second)}
	reporter := managedTransferProgressReporter{
		now: func() time.Time {
			value := times[0]
			times = times[1:]
			return value
		},
	}
	baseTransfer := pfregistry.ManagedOperationTransferProgress{ArtifactReference: "example.invalid/app:1", ArtifactIndex: 2, ArtifactTotal: 3}
	if transfer, emit := reporter.observe(baseTransfer); !emit || transfer.ArtifactIndex != 2 || transfer.ArtifactTotal != 3 {
		t.Fatalf("initial transfer=%+v emit=%t", transfer, emit)
	}
	baseTransfer.Phase, baseTransfer.DownloadedBytes, baseTransfer.TotalBytes, baseTransfer.CompletedLayers, baseTransfer.TotalLayers = "pulling", 1_000_000, 4_000_000, 1, 4
	if transfer, emit := reporter.observe(baseTransfer); !emit || transfer.BytesPerSecond != 1_000_000 {
		t.Fatalf("first byte transfer=%+v emit=%t", transfer, emit)
	}
	baseTransfer.DownloadedBytes = 1_500_000
	if _, emit := reporter.observe(baseTransfer); emit {
		t.Fatal("sub-500ms update was emitted")
	}
	baseTransfer.DownloadedBytes, baseTransfer.CompletedLayers = 2_500_000, 2
	transfer, emit := reporter.observe(baseTransfer)
	if !emit || transfer.BytesPerSecond != 1_250_000 || transfer.DownloadedBytes != 2_500_000 || transfer.CompletedLayers != 2 {
		t.Fatalf("smoothed transfer=%+v emit=%t", transfer, emit)
	}
}

func TestManagedTransferProgressReporterPreservesPinnedCacheFacts(t *testing.T) {
	t.Parallel()
	reporter := managedTransferProgressReporter{now: func() time.Time { return time.Unix(100, 0) }}
	transfer, emit := reporter.observe(pfregistry.ManagedOperationTransferProgress{
		Phase: "cached", ArtifactReference: "example.invalid/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		ArtifactIndex: 1, ArtifactTotal: 1, CompletedLayers: 17, TotalLayers: 17,
	})
	if !emit || transfer.Phase != "cached" || transfer.CompletedLayers != 17 || transfer.TotalLayers != 17 || transfer.DownloadedBytes != 0 || transfer.TotalBytes != 0 || transfer.BytesPerSecond != 0 {
		t.Fatalf("cached transfer=%+v emit=%t", transfer, emit)
	}
}

func TestManagedImagePullErrorMapsStableContainerFailures(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		cause     error
		wantCode  string
		retryable bool
	}{
		{name: "timeout", cause: containerengine.ErrEngineTimeout, wantCode: "IMAGE_PULL_TIMEOUT", retryable: true},
		{name: "registry unavailable", cause: containerengine.ErrImageRegistryUnavailable, wantCode: "IMAGE_REGISTRY_UNAVAILABLE", retryable: true},
		{name: "manifest unavailable", cause: containerengine.ErrImageNotFound, wantCode: "IMAGE_UNAVAILABLE", retryable: false},
		{name: "access denied", cause: containerengine.ErrImageAccessDenied, wantCode: "IMAGE_REGISTRY_ACCESS_DENIED", retryable: false},
		{name: "rate limited", cause: containerengine.ErrImageRateLimited, wantCode: "IMAGE_REGISTRY_RATE_LIMITED", retryable: true},
		{name: "storage exhausted", cause: containerengine.ErrInsufficientStorage, wantCode: "IMAGE_PULL_STORAGE_EXHAUSTED", retryable: false},
		{name: "Docker unavailable", cause: containerengine.ErrEngineUnavailable, wantCode: "DOCKER_UNAVAILABLE", retryable: true},
		{name: "unknown", cause: errors.New("unknown"), wantCode: "IMAGE_PULL_FAILED", retryable: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			code, _, _, retryable := ErrorDetails(managedImagePullError(tt.cause))
			if code != tt.wantCode || retryable != tt.retryable {
				t.Fatalf("managedImagePullError() = (%q, retryable=%t), want (%q, retryable=%t)", code, retryable, tt.wantCode, tt.retryable)
			}
		})
	}
	if err := managedImagePullError(context.Canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled image pull error = %v", err)
	}
}
