package redevpluginintegration

import (
	"context"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redevplugin/v3/pkg/host"
)

// Background work belongs to the installed environment, not an online user.
// The Host owns package admission, grants, claims and execution fencing.
type backgroundPolicyAdapter struct{ permissions sessionPermissions }

func newBackgroundPolicyAdapter(policy *config.PermissionPolicy) backgroundPolicyAdapter {
	if policy == nil || policy.LocalMax == nil || policy.Validate() != nil {
		return backgroundPolicyAdapter{}
	}
	cap := policy.ResolveCap("", "com.floegence.redeven.agent")
	return backgroundPolicyAdapter{permissions: sessionPermissions{read: cap.Read, write: cap.Write, execute: cap.Execute}}
}

func (p backgroundPolicyAdapter) EvaluateBackgroundPolicy(ctx context.Context, request host.BackgroundPolicyRequest) (host.PolicyDecision, error) {
	if err := ctx.Err(); err != nil {
		return host.PolicyDeny, err
	}
	if !permissionAllowsEffect(p.permissions, request.Effect) {
		return host.PolicyDeny, nil
	}
	return host.PolicyAllow, nil
}
