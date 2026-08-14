package redevpluginintegration

import (
	"errors"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/pkg/sessionctx"
)

const maximumSessionGenerationValueSize = 256

// PluginSessionGeneration is transient Redeven connection identity. Durable
// session-scope teardown state and its opaque identity are owned by Host.
type PluginSessionGeneration struct {
	Session           sessionctx.Context
	ProcessGeneration string
	SessionGeneration string
}

type RuntimeProcessAuthority struct {
	lock              *lockfile.Lock
	lockPath          string
	processGeneration string
}

func NewRuntimeProcessAuthority(runtimeLock *lockfile.Lock, expectedLockPath, processGeneration string) (*RuntimeProcessAuthority, error) {
	expectedLockPath = filepath.Clean(strings.TrimSpace(expectedLockPath))
	if runtimeLock == nil || !runtimeLock.Held() || expectedLockPath == "." || !filepath.IsAbs(expectedLockPath) ||
		filepath.Clean(runtimeLock.Path()) != expectedLockPath || !validSessionGenerationValue(processGeneration) {
		return nil, errors.New("runtime process lock authority is invalid")
	}
	return &RuntimeProcessAuthority{lock: runtimeLock, lockPath: expectedLockPath, processGeneration: processGeneration}, nil
}

func (authority *RuntimeProcessAuthority) ProcessGeneration() string {
	if !authority.valid() {
		return ""
	}
	return authority.processGeneration
}

func (authority *RuntimeProcessAuthority) valid() bool {
	return authority != nil && authority.lock != nil && authority.lock.Held() &&
		filepath.Clean(authority.lock.Path()) == authority.lockPath && filepath.IsAbs(authority.lockPath) &&
		validSessionGenerationValue(authority.processGeneration)
}

func PluginSessionGenerationFromMeta(meta *session.Meta, processGeneration, sessionGeneration string) (PluginSessionGeneration, error) {
	sessionContext, err := canonicalPluginSessionContextFromMeta(strings.TrimSpace(metaChannelID(meta)), meta)
	if err != nil {
		return PluginSessionGeneration{}, err
	}
	generation := PluginSessionGeneration{
		Session: sessionContext, ProcessGeneration: processGeneration, SessionGeneration: sessionGeneration,
	}
	if _, err := validatePluginSessionGeneration(generation); err != nil {
		return PluginSessionGeneration{}, err
	}
	return generation, nil
}

func metaChannelID(meta *session.Meta) string {
	if meta == nil {
		return ""
	}
	return meta.ChannelID
}

func validatePluginSessionGeneration(generation PluginSessionGeneration) (sessionctx.SessionScope, error) {
	scope, err := generation.Session.SessionScope()
	if err != nil {
		return sessionctx.SessionScope{}, err
	}
	if !validSessionGenerationValue(generation.ProcessGeneration) || !validSessionGenerationValue(generation.SessionGeneration) {
		return sessionctx.SessionScope{}, errors.New("plugin session generation is invalid")
	}
	return scope, nil
}

func validSessionGenerationValue(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maximumSessionGenerationValueSize {
		return false
	}
	for index := range len(value) {
		character := value[index]
		if character < 0x21 || character > 0x7e {
			return false
		}
	}
	return true
}
