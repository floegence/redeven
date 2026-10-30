package redevpluginintegration

import (
	"context"
	"errors"
	"net/http"

	"github.com/floegence/redeven/internal/pluginorigin"
	"github.com/floegence/redevplugin/v3/pkg/host"
)

type surfaceOriginAdapter struct{}

func (surfaceOriginAdapter) AllocateSurfaceOrigin(ctx context.Context, request host.SurfaceOriginRequest) (host.SurfaceOrigin, error) {
	parent, ok := ctx.Value(trustedOriginContextKey{}).(string)
	if !ok || validateTrustedOrigin(parent) != nil {
		return host.SurfaceOrigin{}, errors.New("trusted parent route is required")
	}
	origin, err := pluginorigin.Child(parent, request.OriginKey)
	if err != nil {
		return host.SurfaceOrigin{}, err
	}
	return host.SurfaceOrigin{Origin: origin, ParentOrigin: parent}, nil
}

func trustedWebSurfaceOrigin(r *http.Request) (string, error) {
	origin, ok := trustedOriginFromRequest(r)
	if !ok {
		return "", errors.New("trusted resource route is required")
	}
	return origin, nil
}

func (i *Integration) WebSurfaceHandler() http.Handler { return i.webHandler }
