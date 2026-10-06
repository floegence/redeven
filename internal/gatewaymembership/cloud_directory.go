package gatewaymembership

// AcknowledgeCloudDirectory clears only the exact local denial observations
// committed by Cloud. A newer local edit cannot be acknowledged by an old sync.
func (s *Store) AcknowledgeCloudDirectory(namespace string, policyRevision int64, observed []MemberRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.CloudNamespaceID != namespace || s.state.Policy.Revision != policyRevision {
		return nil
	}
	next := s.clone()
	changed := false
	for _, observation := range observed {
		id := observation.Member.MemberID
		current, ok := next.Members[id]
		if !ok || current.Member.MemberVersion != observation.Member.MemberVersion || current.Member.State != observation.Member.State || current.Member.CloudPermission != observation.Member.CloudPermission || current.HookCloudAllowed != observation.HookCloudAllowed || current.HookPolicyRevision != observation.HookPolicyRevision {
			continue
		}
		if current.Member.State == "removed" {
			delete(next.Members, id)
			changed = true
		} else if current.Member.CloudRevocationPending {
			current.Member.CloudRevocationPending = false
			next.Members[id] = current
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return s.commit(next)
}
