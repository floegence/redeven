package accessgate

import (
	"errors"
	"strings"
	"time"
)

type childDelegation struct {
	parent          *resumeTokenState
	codeSpaceID     string
	expires         time.Time
	consumedChannel string
	result          *UnlockResult
}

// DelegateCodeSpace narrows an authenticated Env App session to one editor.
// The child still receives its own independently checked permission metadata.
func (g *Gate) DelegateCodeSpace(channelID, codeSpaceID string) (string, error) {
	if g == nil || !g.Enabled() {
		return "", nil
	}
	g.authMu.Lock()
	defer g.authMu.Unlock()
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	g.cleanupExpiredLocked(now)
	st := g.channels[channelID]
	if st == nil || !st.unlocked || st.meta.FloeApp != "com.floegence.redeven.agent" || st.meta.CodeSpaceID != "env-ui" || !st.meta.CanRead || !st.meta.CanWrite || !st.meta.CanExecute {
		return "", errors.New("environment access is required")
	}
	codeSpaceID = strings.TrimSpace(codeSpaceID)
	if codeSpaceID == "" || len(codeSpaceID) > 64 {
		return "", errors.New("invalid codespace")
	}
	for token, item := range g.delegations {
		if !now.Before(item.expires) {
			delete(g.delegations, token)
		}
	}
	if len(g.delegations) >= 256 {
		return "", errors.New("too many pending editor connections")
	}
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	parent := &resumeTokenState{accessSessionID: st.accessSessionID, userPublicID: st.meta.UserPublicID, endpointID: st.meta.EndpointID, expiresAt: st.expiresAt}
	if parent.expiresAt.IsZero() && st.trusted {
		parent.expiresAt = now.Add(g.resumeTTL)
	}
	g.delegations[token] = &childDelegation{parent: parent, codeSpaceID: codeSpaceID, expires: now.Add(30 * time.Second)}
	return token, nil
}

func (g *Gate) consumeCodeSpaceLocked(channelID, token string) (*UnlockResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	g.cleanupExpiredLocked(now)
	st := g.channels[channelID]
	d := g.delegations[token]
	if st == nil || d == nil || !now.Before(d.expires) || !now.Before(d.parent.expiresAt) || st.meta.FloeApp != "com.floegence.redeven.code" || st.meta.CodeSpaceID != d.codeSpaceID || st.meta.UserPublicID != d.parent.userPublicID || st.meta.EndpointID != d.parent.endpointID {
		return nil, errors.New("editor authorization expired; reopen it from the environment")
	}
	if d.consumedChannel != "" {
		if d.consumedChannel == channelID {
			return d.result, nil
		}
		return nil, errors.New("editor authorization already used")
	}
	resume, _, err := g.mintResumeTokenLocked(now, st.meta, d.parent.accessSessionID)
	if err != nil {
		return nil, err
	}
	g.resumeTokens[resume].expiresAt = d.parent.expiresAt
	st.unlocked = true
	st.unlockedAt = now
	st.expiresAt = d.parent.expiresAt
	st.accessSessionID = d.parent.accessSessionID
	g.scheduleChannelExpiryLocked(channelID, st)
	d.consumedChannel = channelID
	d.result = &UnlockResult{Unlocked: true, ResumeToken: resume, ResumeExpiresAtUnix: st.expiresAt.UnixMilli()}
	return d.result, nil
}

func (g *Gate) scheduleChannelExpiryLocked(channelID string, st *channelState) {
	if st.expiryTimer != nil {
		st.expiryTimer.Stop()
		st.expiryTimer = nil
	}
	if st.expiresAt.IsZero() || st.trusted {
		return
	}
	deadline := st.expiresAt
	st.expiryTimer = time.AfterFunc(time.Until(deadline), func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		if g.channels[channelID] == st && st.expiresAt.Equal(deadline) {
			st.unlocked = false
			if st.cancel != nil {
				st.cancel()
			}
		}
	})
}
