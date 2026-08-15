package redevpluginintegration

import (
	"context"
	"errors"

	"github.com/floegence/redevplugin/v2/pkg/host"
)

var errNetworkPolicyDenied = errors.New("network policy denied")

type networkPolicyAdapter struct {
	sessions *sessionPermissionCache
}

func newNetworkPolicyAdapter(sessions *sessionPermissionCache) *networkPolicyAdapter {
	return &networkPolicyAdapter{sessions: sessions}
}

// Redeven owns any enterprise/environment policy outside this repository. The
// adapter only verifies the authenticated session boundary and deliberately
// does not create a second URL allowlist or connection-grant model.
func (adapter *networkPolicyAdapter) AuthorizeNetwork(_ context.Context, request host.NetworkAuthorizationRequest) error {
	if adapter == nil || adapter.sessions == nil {
		return errNetworkPolicyDenied
	}
	resolved, ok := adapter.sessions.Get(request.Session)
	if !ok || !resolved.context.CanRead {
		return errNetworkPolicyDenied
	}
	return nil
}

func newIOModule(homePath string, sessions *sessionPermissionCache, workspacePath workspacePathResolver) (*host.IOModule, error) {
	filesystem, err := newFileSystemAdapter(homePath, sessions, workspacePath)
	if err != nil {
		return nil, err
	}
	return &host.IOModule{
		FileSystem:    filesystem,
		NetworkPolicy: newNetworkPolicyAdapter(sessions),
	}, nil
}
