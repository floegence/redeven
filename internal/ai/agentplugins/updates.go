package agentplugins

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"time"
)

// Update checks only resolve a GitHub ref. They never download, install, enable,
// discover tools, or execute package content. Applying bytes still requires review.
func (m *Manager) runUpdateChecks() {
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-timer.C:
			installs, _ := m.List()
			for _, in := range installs {
				if in.AutoCheck && in.Source.Type == "github" && time.Since(time.UnixMilli(in.Update.CheckedAt)) >= 6*time.Hour {
					m.checkUpdate(m.ctx, in)
				}
			}
			timer.Reset(30 * time.Minute)
		}
	}
}
func (m *Manager) checkUpdate(ctx context.Context, in Install) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	ref := in.Source.Ref
	if ref == "" {
		ref = "HEAD"
	}
	b, e := get(ctx, m.http, "https://api.github.com/repos/"+in.Source.Repository+"/commits/"+url.PathEscape(ref), MaxConfigBytes)
	var response struct {
		SHA string `json:"sha"`
	}
	if e == nil {
		if json.Unmarshal(b, &response) != nil || !commitName.MatchString(response.SHA) {
			e = errors.New("invalid commit response")
		}
	}
	status := UpdateStatus{CheckedAt: time.Now().UnixMilli(), Failed: e != nil}
	if e == nil {
		status.Commit = response.SHA
		status.Available = response.SHA != in.Source.Commit
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneState(m.state)
	for i := range next.Installs {
		current := &next.Installs[i]
		if current.ID == in.ID && current.Revision == in.Revision && current.AutoCheck {
			current.Update = status
			_ = m.saveLocked(next)
			return
		}
	}
}
