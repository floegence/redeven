package redevpluginintegration

import (
	"context"
	"errors"
	"os"

	"github.com/floegence/redevplugin/v3/pkg/process"
)

func newProcessSupervisor(sessions *sessionAdapter, resolveSecret process.SecretResolver) (*process.Supervisor, error) {
	if sessions == nil {
		return nil, errors.New("session adapter is required for process supervisor")
	}
	environment := []string{"PATH=" + os.Getenv("PATH")}
	if systemRoot := os.Getenv("SystemRoot"); systemRoot != "" {
		environment = append(environment, "SystemRoot="+systemRoot)
	}
	return process.NewSupervisor(process.Options{
		BaseEnvironment: environment,
		Secrets:         resolveSecret,
		Permission:      sessions.authorizeProcessOwner,
	})
}

func (a *sessionAdapter) authorizeProcessOwner(_ context.Context, owner process.Owner) error {
	if a == nil || a.resolver == nil || a.resolver.cache == nil || !owner.ValidForHost() {
		return process.ErrPermissionDenied
	}
	if owner.UserScope == backgroundUserScope {
		return nil
	}
	if !a.resolver.cache.hasOwner(owner.UserScope, owner.EnvironmentScope) {
		return process.ErrPermissionDenied
	}
	return nil
}

const backgroundUserScope = "background"

func (c *sessionPermissionCache) hasOwner(userScope, environmentScope string) bool {
	if c == nil || userScope == "" || environmentScope == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for element := c.recency.Front(); element != nil; element = element.Next() {
		resolved := element.Value.(*sessionPermissionCacheEntry).resolved.context
		if resolved.OwnerUserHash == userScope && resolved.OwnerEnvHash == environmentScope {
			return true
		}
	}
	return false
}
