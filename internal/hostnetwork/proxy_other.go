//go:build !darwin

package hostnetwork

import (
	"context"
	"net/url"
)

// Non-Darwin hosts use explicit environment proxies or native OS routing.
func systemProxies(ctx context.Context, _ *url.URL, _ string) ([]*url.URL, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return []*url.URL{nil}, nil
}
