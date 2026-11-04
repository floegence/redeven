package redevpluginintegration

import (
	"context"
	"errors"

	"github.com/floegence/redevplugin/v3/pkg/connectivity"
	"github.com/floegence/redevplugin/v3/pkg/host"
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

// Private connections require an authenticated administrator whose effective
// environment policy permits read, write and execution. The platform owns the
// exact destination review, revision-bound approval, address pinning and revoke.
func (adapter *networkPolicyAdapter) AuthorizePrivateNetwork(_ context.Context, request host.PrivateNetworkRequest) error {
	if adapter == nil || adapter.sessions == nil {
		return errNetworkPolicyDenied
	}
	resolved, ok := adapter.sessions.Get(request.Session)
	if !ok || !permissionsAllowAction(resolved.permissions, host.ManagementActionApproveConnection) {
		return errNetworkPolicyDenied
	}
	if len(request.PrivatePrefixes) == 0 || connectivity.ValidateApprovedDestination(request.Destination, request.PrivatePrefixes) != nil {
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
