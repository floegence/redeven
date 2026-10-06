package gatewaymembership

import (
	"context"
	"sync"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// evaluateCloud evaluates a prospective transaction without holding the store
// lock. No intermediate policy is published and an interrupted request commits
// nothing. Eight workers share the same global hook concurrency limit.
func (s *Store) evaluateCloud(ctx context.Context, next *memberState, ids []string) error {
	if ctx == nil {
		return ErrState
	}
	results := make([]MemberRecord, len(ids))
	jobs := make(chan int)
	var workers sync.WaitGroup
	for range min(8, len(ids)) {
		workers.Go(func() {
			for i := range jobs {
				member := next.Members[ids[i]]
				allowed := false
				if ctx.Err() == nil && next.CloudNamespaceID != "" && member.Member.State == "active" && member.Member.CloudPermission != gp.CloudDeny && (member.Member.CloudPermission == gp.CloudAllow || next.Policy.DefaultCloudAllowed) {
					allowed = s.hooks.Evaluate(ctx, gp.HookInput{Version: 1, Action: gp.HookCloudPublish, GatewayID: s.identity.ID, MemberID: member.Member.MemberID, RuntimePublicID: member.Member.RuntimePublicID, NamespacePublicID: next.CloudNamespaceID, PolicyRevision: next.Policy.Revision}).Allowed
				}
				member.HookCloudAllowed, member.HookPolicyRevision = allowed, next.Policy.Revision
				results[i] = member
			}
		})
	}
	for i := range ids {
		select {
		case jobs <- i:
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return ctx.Err()
		}
	}
	close(jobs)
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	for i, member := range results {
		next.Members[ids[i]] = member
	}
	return nil
}

func policyMemberIDs(next memberState) []string {
	ids := make([]string, 0, len(next.Members))
	for id := range next.Members {
		ids = append(ids, id)
	}
	return ids
}

func (s *Store) commitPolicy(ctx context.Context, next memberState, revision int64, ids []string) error {
	if err := s.evaluateCloud(ctx, &next, ids); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Revision != revision {
		return ErrConflict
	}
	return s.commit(next)
}

func (s *Store) UpdatePolicy(ctx context.Context, expected int64, policy gp.GatewayPolicy) error {
	if policy.PublicationMode != gp.PublicationManual && policy.PublicationMode != gp.PublicationAutomatic {
		return ErrState
	}
	s.mu.Lock()
	if s.state.Policy.Revision != expected {
		s.mu.Unlock()
		return ErrConflict
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	policy.Revision = expected + 1
	next.Policy = policy
	return s.commitPolicy(ctx, next, revision, policyMemberIDs(next))
}

func (s *Store) UpdateMemberPolicy(ctx context.Context, update gp.MemberPolicyUpdate) error {
	if update.CloudPermission != gp.CloudAllow && update.CloudPermission != gp.CloudDeny && update.CloudPermission != gp.CloudInherit {
		return ErrState
	}
	s.mu.Lock()
	member, ok := s.state.Members[update.MemberID]
	if !ok || member.Member.State != "active" {
		s.mu.Unlock()
		return ErrDenied
	}
	if member.Member.MemberVersion != update.ExpectedMemberVersion {
		s.mu.Unlock()
		return ErrConflict
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	member.Member.CloudPermission = update.CloudPermission
	next.Members[update.MemberID] = member
	return s.commitPolicy(ctx, next, revision, []string{update.MemberID})
}

// SetCloudNamespace is called only by the authenticated Cloud association owner.
// The namespace is never taken from a Desktop or Runtime policy request.
func (s *Store) SetCloudNamespace(ctx context.Context, namespaceID string) error {
	if namespaceID != "" && !validID(namespaceID) {
		return ErrState
	}
	s.mu.Lock()
	if s.state.CloudNamespaceID == namespaceID {
		s.mu.Unlock()
		return nil
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	next.CloudNamespaceID = namespaceID
	next.Policy.Revision++
	return s.commitPolicy(ctx, next, revision, policyMemberIDs(next))
}

// ReevaluateCloud uses the current authoritative namespace and commits only the
// exact snapshot evaluated. It cannot restore an explicitly revoked Cloud binding.
func (s *Store) ReevaluateCloud(ctx context.Context, memberID string) error {
	s.mu.Lock()
	member, ok := s.state.Members[memberID]
	if !ok || member.Member.State != "active" {
		s.mu.Unlock()
		return ErrDenied
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	return s.commitPolicy(ctx, next, revision, []string{memberID})
}
