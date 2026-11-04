package managedwebservice

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type progressImageClient struct {
	catalogDockerEngineClient
	failure error
}

func (c progressImageClient) PullImageWithProgress(ctx context.Context, engine containerengine.Engine, ref string, sink containerengine.ImagePullProgressSink) (containerengine.EngineImageResult, error) {
	if err := sink(ctx, containerengine.ImagePullProgress{Phase: "pulling", DownloadedBytes: 1_000_000, Output: "layer: Downloading 1MB/2MB token=private-value"}); err != nil {
		return containerengine.EngineImageResult{}, err
	}
	return containerengine.EngineImageResult{Engine: engine, Image: containerengine.ImageInput{Reference: ref}, Completed: c.failure == nil}, c.failure
}

func newImagePullTestReporter(t *testing.T) (*operationReporter, *pfregistry.Registry) {
	t.Helper()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	operation := pfregistry.ManagedOperation{OperationID: "pull", ServiceID: "service", RequestID: "request", RequestFingerprint: "fingerprint", Action: "update", State: "running", Stage: "pulling", ProgressTotal: 7}
	if err := registry.CreateManagedOperation(context.Background(), operation); err != nil {
		t.Fatal(err)
	}
	reporter := newOperationReporter(&Manager{registry: registry, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}, &operation, nil)
	t.Cleanup(func() { reporter.Close(); _ = registry.Close() })
	return reporter, registry
}

func TestManagedImagePullPersistsCommandOutputAndTerminalState(t *testing.T) {
	for _, tc := range []struct {
		state   string
		failure error
	}{
		{"succeeded", nil}, {"failed", containerengine.ErrImageNotFound}, {"cancelled", context.Canceled},
	} {
		t.Run(tc.state, func(t *testing.T) {
			reporter, registry := newImagePullTestReporter(t)
			reporter.secretValues = []string{"private-value"}
			adapter, err := containerengine.NewAdapter(progressImageClient{failure: tc.failure})
			if err != nil {
				t.Fatal(err)
			}
			_, err = pullManagedImage(withOperationReporter(context.Background(), reporter), adapter, "example.invalid/image:1", 1, 1, reporter.Progress)
			if (err != nil) != (tc.failure != nil) {
				t.Fatalf("pull error=%v", err)
			}
			op, err := registry.GetManagedOperation(context.Background(), "pull")
			if err != nil {
				t.Fatal(err)
			}
			detail := op.ProgressDetail
			if detail == nil || len(detail.Commands) != 1 || detail.Commands[0].Display != "docker pull example.invalid/image:1" || detail.Commands[0].State != tc.state || len(detail.Output) != 1 || detail.Transfer.DownloadedBytes != 1_000_000 {
				t.Fatalf("incomplete persisted pull: %+v", detail)
			}
			if strings.Contains(detail.Output[0].Text, "private-value") {
				t.Fatal("unredacted output")
			}
		})
	}
}

func TestManagedTransferRateSurvivesSparseUpdatesAndStopsOnExtraction(t *testing.T) {
	now := time.Unix(100, 0)
	reporter := managedTransferProgressReporter{now: func() time.Time { return now }}
	item := pfregistry.ManagedOperationTransferProgress{Phase: "pulling"}
	reporter.observe(item)
	now = now.Add(4 * time.Second)
	item.DownloadedBytes = 4_000_000
	got, _ := reporter.observe(item)
	if got.BytesPerSecond != 1_000_000 {
		t.Fatalf("sparse rate=%d", got.BytesPerSecond)
	}
	now = now.Add(4 * time.Second)
	item.Phase = "extracting"
	got, _ = reporter.observe(item)
	if got.BytesPerSecond != 0 || got.DownloadedBytes != 4_000_000 {
		t.Fatalf("stale rate=%+v", got)
	}
}

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
