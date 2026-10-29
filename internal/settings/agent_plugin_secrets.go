package settings

import (
	"context"
	"errors"
	"maps"
	"strings"

	"github.com/google/uuid"
)

// AgentPluginCredential returns secrets only to the authenticated runtime adapter.
// Public views contain keys and a reference, never these values.
func (s *SecretsStore) AgentPluginCredential(ref string) (map[string]string, error) {
	if ref == "" {
		return map[string]string{}, nil
	}
	if _, e := uuid.Parse(ref); e != nil {
		return nil, errors.New("invalid credential reference")
	}
	unlock, e := s.lock(context.Background())
	if e != nil {
		return nil, e
	}
	defer unlock()
	sf, e := s.loadLocked()
	if e != nil {
		return nil, e
	}
	values, ok := sf.AgentPlugins[ref]
	if !ok {
		return nil, errors.New("credential_unavailable")
	}
	return maps.Clone(values), nil
}
func (s *SecretsStore) PutAgentPluginCredential(values map[string]string) (string, error) {
	if len(values) > 64 {
		return "", errors.New("too many credential fields")
	}
	for key, value := range values {
		if key == "" || len(key) > 128 || len(value) > 8192 || strings.ContainsAny(key, "\x00\r\n") || strings.ContainsRune(value, 0) {
			return "", errors.New("invalid credential field")
		}
	}
	unlock, e := s.lock(context.Background())
	if e != nil {
		return "", e
	}
	defer unlock()
	sf, e := s.loadLocked()
	if e != nil {
		return "", e
	}
	if sf.AgentPlugins == nil {
		sf.AgentPlugins = map[string]map[string]string{}
	}
	ref := uuid.NewString()
	sf.AgentPlugins[ref] = maps.Clone(values)
	return ref, s.saveLocked(sf)
}
func (s *SecretsStore) DeleteAgentPluginCredential(ref string) error {
	if ref == "" {
		return nil
	}
	unlock, e := s.lock(context.Background())
	if e != nil {
		return e
	}
	defer unlock()
	sf, e := s.loadLocked()
	if e != nil {
		return e
	}
	delete(sf.AgentPlugins, ref)
	return s.saveLocked(sf)
}
