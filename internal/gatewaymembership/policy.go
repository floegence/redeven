package gatewaymembership

import (
	"context"
	"sync"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// evaluateEgress evaluates a prospective transaction without holding the store
// lock. No intermediate policy is published and an interrupted request commits
// nothing. Eight workers share the same global hook concurrency limit.
func (s *Store) evaluateEgress(ctx context.Context, next *memberState, ids []string) error {
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
				if ctx.Err() == nil && member.Member.State == "active" && member.Member.EgressPermission != gp.EgressDeny && (member.Member.EgressPermission == gp.EgressAllow || next.Policy.DefaultEgressAllowed) {
					allowed = s.hooks.Evaluate(ctx, gp.HookInput{Version: 1, Action: gp.HookEgressOpen, GatewayID: s.identity.ID, AttachmentID: member.Member.AttachmentID, RuntimePublicID: member.Member.RuntimePublicID, PolicyRevision: next.Policy.Revision}).Allowed
				}
				member.HookEgressAllowed, member.HookPolicyRevision = allowed, next.Policy.Revision
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

func policyAttachmentIDs(next memberState) []string {
	ids := make([]string, 0, len(next.Members))
	for id := range next.Members {
		ids = append(ids, id)
	}
	return ids
}

func (s *Store) commitPolicy(ctx context.Context, next memberState, revision int64, ids []string) error {
	if err := s.evaluateEgress(ctx, &next, ids); err != nil {
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
	if err := gp.ValidateEgressDestinations(policy.Destinations); err != nil {
		return err
	}
	policy.Destinations = append([]string{}, policy.Destinations...)
	s.mu.Lock()
	if s.state.Policy.Revision != expected {
		s.mu.Unlock()
		return ErrConflict
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	policy.Revision = expected + 1
	next.Policy = policy
	return s.commitPolicy(ctx, next, revision, policyAttachmentIDs(next))
}

func (s *Store) UpdateMemberPolicy(ctx context.Context, update gp.MemberPolicyUpdate) error {
	if update.EgressPermission != gp.EgressAllow && update.EgressPermission != gp.EgressDeny && update.EgressPermission != gp.EgressInherit {
		return ErrState
	}
	s.mu.Lock()
	member, ok := s.state.Members[update.AttachmentID]
	if !ok || member.Member.State != "active" {
		s.mu.Unlock()
		return ErrDenied
	}
	if member.Member.AttachmentVersion != update.ExpectedAttachmentVersion {
		s.mu.Unlock()
		return ErrConflict
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	member.Member.EgressPermission = update.EgressPermission
	next.Members[update.AttachmentID] = member
	return s.commitPolicy(ctx, next, revision, []string{update.AttachmentID})
}

// ReevaluateEgress applies the current local policy to one exact attachment version.
func (s *Store) ReevaluateEgress(ctx context.Context, memberID string, expectedVersion int64) error {
	s.mu.Lock()
	member, ok := s.state.Members[memberID]
	if !ok || member.Member.State != "active" {
		s.mu.Unlock()
		return ErrDenied
	}
	if member.Member.AttachmentVersion != expectedVersion {
		s.mu.Unlock()
		return ErrConflict
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	return s.commitPolicy(ctx, next, revision, []string{memberID})
}
