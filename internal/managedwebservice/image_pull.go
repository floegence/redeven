package managedwebservice

import (
	"context"
	"errors"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func pullManagedImage(ctx context.Context, adapter *containerengine.Adapter, imageRef string, artifactIndex, artifactTotal int64, progress operationProgress) (containerengine.ImagePullResponse, error) {
	if adapter == nil {
		return containerengine.ImagePullResponse{}, managedImagePullError(containerengine.ErrEngineUnavailable)
	}
	reporter := managedTransferProgressReporter{now: time.Now}
	pulled, err := adapter.PullImageWithProgress(ctx, containerengine.ImagePullRequest{Engine: containerengine.EngineDocker, ImageRef: imageRef}, func(_ context.Context, item containerengine.ImagePullProgress) error {
		transfer, emit := reporter.observe(pfregistry.ManagedOperationTransferProgress{
			Phase: item.Phase, ArtifactReference: imageRef, ArtifactIndex: artifactIndex, ArtifactTotal: artifactTotal,
			DownloadedBytes: item.DownloadedBytes, TotalBytes: item.TotalBytes,
			CompletedLayers: item.CompletedLayers, TotalLayers: item.TotalLayers,
		})
		if emit && progress != nil {
			progress("pulling", 2, transfer)
		}
		return nil
	})
	if err != nil {
		return containerengine.ImagePullResponse{}, managedImagePullError(err)
	}
	if !pulled.Completed {
		return containerengine.ImagePullResponse{}, managedImagePullError(nil)
	}
	return pulled, nil
}

func managedImagePullError(cause error) error {
	switch {
	case errors.Is(cause, context.Canceled):
		return cause
	case errors.Is(cause, containerengine.ErrEngineTimeout), errors.Is(cause, context.DeadlineExceeded):
		return serviceError("IMAGE_PULL_TIMEOUT", "The container image pull timed out. Check the registry connection, then retry.", 504, true, cause)
	case errors.Is(cause, containerengine.ErrImageRegistryUnavailable), errors.Is(cause, containerengine.ErrBackendUnreachable):
		return serviceError("IMAGE_REGISTRY_UNAVAILABLE", "The container image registry is unavailable. Check the network connection, then retry.", 503, true, cause)
	case errors.Is(cause, containerengine.ErrImageNotFound):
		return serviceError("IMAGE_UNAVAILABLE", "The container image is unavailable at the configured registry.", 409, false, cause)
	case errors.Is(cause, containerengine.ErrImageAccessDenied):
		return serviceError("IMAGE_REGISTRY_ACCESS_DENIED", "The container image registry denied access to this image.", 403, false, cause)
	case errors.Is(cause, containerengine.ErrImageRateLimited):
		return serviceError("IMAGE_REGISTRY_RATE_LIMITED", "The container image registry rate limit was reached. Wait, then retry.", 429, true, cause)
	case errors.Is(cause, containerengine.ErrInsufficientStorage):
		return serviceError("IMAGE_PULL_STORAGE_EXHAUSTED", "There is not enough container storage to pull this image. Free space, then retry.", 507, false, cause)
	case errors.Is(cause, containerengine.ErrPermissionDenied):
		return serviceError("DOCKER_PERMISSION_DENIED", "Redeven does not have permission to use Docker in this Environment.", 403, false, cause)
	case errors.Is(cause, containerengine.ErrDaemonStopped), errors.Is(cause, containerengine.ErrEngineUnavailable), errors.Is(cause, containerengine.ErrCLIUnavailable):
		return serviceError("DOCKER_UNAVAILABLE", "Docker is not available in this Environment.", 409, true, cause)
	default:
		return serviceError("IMAGE_PULL_FAILED", "The container image could not be pulled.", 503, true, cause)
	}
}
