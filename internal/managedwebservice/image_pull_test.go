package managedwebservice

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

func TestManagedImageProgressReporterSeparatesLayersBytesAndSmoothsRate(t *testing.T) {
	t.Parallel()
	base := time.Unix(100, 0)
	times := []time.Time{base, base.Add(time.Second), base.Add(1200 * time.Millisecond), base.Add(2 * time.Second)}
	reporter := managedImageProgressReporter{
		now: func() time.Time {
			value := times[0]
			times = times[1:]
			return value
		},
		artifact: "example.invalid/app:1", artifactIndex: 2, artifactTotal: 3,
	}
	if transfer, emit := reporter.observe(containerengine.ImagePullProgress{Phase: "resolving"}); !emit || transfer.ArtifactIndex != 2 || transfer.ArtifactTotal != 3 {
		t.Fatalf("initial transfer=%+v emit=%t", transfer, emit)
	}
	if transfer, emit := reporter.observe(containerengine.ImagePullProgress{Phase: "pulling", DownloadedBytes: 1_000_000, TotalBytes: 4_000_000, CompletedLayers: 1, TotalLayers: 4}); !emit || transfer.BytesPerSecond != 1_000_000 {
		t.Fatalf("first byte transfer=%+v emit=%t", transfer, emit)
	}
	if _, emit := reporter.observe(containerengine.ImagePullProgress{Phase: "pulling", DownloadedBytes: 1_500_000, TotalBytes: 4_000_000, CompletedLayers: 1, TotalLayers: 4}); emit {
		t.Fatal("sub-500ms update was emitted")
	}
	transfer, emit := reporter.observe(containerengine.ImagePullProgress{Phase: "pulling", DownloadedBytes: 2_500_000, TotalBytes: 4_000_000, CompletedLayers: 2, TotalLayers: 4})
	if !emit || transfer.BytesPerSecond != 1_250_000 || transfer.DownloadedBytes != 2_500_000 || transfer.CompletedLayers != 2 {
		t.Fatalf("smoothed transfer=%+v emit=%t", transfer, emit)
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
