package redevpluginintegration

import (
	"context"
	"errors"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/manifest"
	"testing"
)

func TestBackgroundPolicyUsesEnvironmentCapsWithoutOnlineSession(t *testing.T) {
	for _, tc := range []struct {
		preset               string
		read, write, execute bool
	}{
		{"read_only", true, false, false}, {"execute_read", true, false, true}, {"execute_read_write", true, true, true},
	} {
		t.Run(tc.preset, func(t *testing.T) {
			adapter := newBackgroundPolicyAdapter(testPermissionPolicy(t, tc.preset))
			for effect, allowed := range map[manifest.MethodEffect]bool{manifest.MethodEffectRead: tc.read, manifest.MethodEffectWrite: tc.write, manifest.MethodEffectExecute: tc.execute, manifest.MethodEffectDelete: tc.write && tc.execute, manifest.MethodEffectAdmin: false, "invalid": false} {
				decision, err := adapter.EvaluateBackgroundPolicy(context.Background(), host.BackgroundPolicyRequest{Effect: effect})
				if err != nil || (decision == host.PolicyAllow) != allowed {
					t.Fatalf("effect=%s decision=%s err=%v", effect, decision, err)
				}
			}
		})
	}
}

func TestBackgroundPolicySnapshotsEnvAppCapAndDoesNotBorrowUserAuthority(t *testing.T) {
	policy := testPermissionPolicy(t, "execute_read_write")
	policy.ByApp = map[string]*config.PermissionSet{"com.floegence.redeven.agent": {Read: true}, "unrelated": {}}
	policy.ByUser = map[string]*config.PermissionSet{"offline-user": {}}
	adapter := newBackgroundPolicyAdapter(policy)
	policy.LocalMax.Read = false
	policy.ByApp["com.floegence.redeven.agent"].Write = true
	for effect, allowed := range map[manifest.MethodEffect]bool{manifest.MethodEffectRead: true, manifest.MethodEffectWrite: false, manifest.MethodEffectExecute: false} {
		decision, err := adapter.EvaluateBackgroundPolicy(context.Background(), host.BackgroundPolicyRequest{Effect: effect})
		if err != nil || (decision == host.PolicyAllow) != allowed {
			t.Fatalf("effect=%s decision=%s err=%v", effect, decision, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if decision, err := adapter.EvaluateBackgroundPolicy(ctx, host.BackgroundPolicyRequest{Effect: manifest.MethodEffectRead}); decision != host.PolicyDeny || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled=%s %v", decision, err)
	}
}

func TestBackgroundPolicyRejectsMissingOrInvalidPolicy(t *testing.T) {
	for _, policy := range []*config.PermissionPolicy{nil, {}, {SchemaVersion: 99, LocalMax: &config.PermissionSet{Read: true}}} {
		decision, err := newBackgroundPolicyAdapter(policy).EvaluateBackgroundPolicy(context.Background(), host.BackgroundPolicyRequest{Effect: manifest.MethodEffectRead})
		if err != nil || decision != host.PolicyDeny {
			t.Fatalf("invalid policy=%s %v", decision, err)
		}
	}
}
