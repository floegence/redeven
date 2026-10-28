package accessgate

import "strings"

// RevokeEntryScope removes only the credentials issued through this verified
// entry generation. The gate remains the sole owner of ordinary authentication.
func (g *Gate) RevokeEntryScope(scope string) []string {
	return g.revokeEntryScopes(scope, false)
}

// RevokeEntryScopeFamily revokes a binding generation and all device children.
func (g *Gate) RevokeEntryScopeFamily(scope string) []string {
	return g.revokeEntryScopes(scope, true)
}

func (g *Gate) revokeEntryScopes(scope string, family bool) []string {
	if g == nil || scope == "" {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	matches := func(value string) bool { return value == scope || family && strings.HasPrefix(value, scope+":") }
	identities := map[string]struct{}{}
	for _, local := range g.localSessions {
		if matches(local.scope) {
			identities[local.accessSessionID] = struct{}{}
		}
	}
	for _, resume := range g.resumeTokens {
		if matches(resume.scope) {
			identities[resume.accessSessionID] = struct{}{}
		}
	}
	for _, channel := range g.channels {
		if matches(channel.scope) {
			identities[channel.accessSessionID] = struct{}{}
		}
	}
	result := make([]string, 0, len(identities))
	for id := range identities {
		g.revokeAccessSessionLocked(id)
		result = append(result, id)
	}
	return result
}
