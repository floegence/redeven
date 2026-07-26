package agent

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/session"
)

type PluginSessionGeneration uint64

type pluginSessionLifecycle interface {
	BindPluginSessionGeneration(context.Context, *session.Meta, string, string) error
	RecordPluginSessionTerminalIntent(context.Context, *session.Meta, string, string) error
	MaintainTerminalPluginSession(context.Context, *session.Meta, string, string) error
}

type pluginSessionState uint8

const (
	pluginSessionActive pluginSessionState = iota + 1
	pluginSessionRetired
	pluginSessionTerminal
)

type pluginSessionRecord struct {
	generation      PluginSessionGeneration
	meta            session.Meta
	accessSessionID string
	credentialHash  [sha256.Size]byte
	hasCredential   bool
	state           pluginSessionState
	admissions      uint64
	drained         chan struct{}
	drainClosed     bool
	closeStarted    bool
}

type pluginSessionClose struct {
	generation PluginSessionGeneration
	channelID  string
}

type authenticatedPluginSessionRegistry struct {
	mu sync.Mutex

	accepting    bool
	next         PluginSessionGeneration
	byGeneration map[PluginSessionGeneration]*pluginSessionRecord
	active       map[string]*pluginSessionRecord
	credentials  map[[sha256.Size]byte]*pluginSessionRecord
}

func newAuthenticatedPluginSessionRegistry() *authenticatedPluginSessionRegistry {
	return &authenticatedPluginSessionRegistry{
		accepting:    true,
		byGeneration: make(map[PluginSessionGeneration]*pluginSessionRecord),
		active:       make(map[string]*pluginSessionRecord),
		credentials:  make(map[[sha256.Size]byte]*pluginSessionRecord),
	}
}

func (r *authenticatedPluginSessionRegistry) register(meta session.Meta, credential string) (PluginSessionGeneration, error) {
	credential = strings.TrimSpace(credential)
	var credentialHash [sha256.Size]byte
	if credential != "" {
		credentialHash = sha256.Sum256([]byte(credential))
	}
	return r.registerCredentialHash(meta, credentialHash, credential != "")
}

func (r *authenticatedPluginSessionRegistry) registerCredentialHash(meta session.Meta, credentialHash [sha256.Size]byte, hasCredential bool) (PluginSessionGeneration, error) {
	return r.registerCredentialHashBound(meta, credentialHash, hasCredential, "", nil)
}

func (r *authenticatedPluginSessionRegistry) registerCredentialHashBound(meta session.Meta, credentialHash [sha256.Size]byte, hasCredential bool, accessSessionID string, bind func(PluginSessionGeneration) error) (PluginSessionGeneration, error) {
	if r == nil {
		return 0, errors.New("plugin session registry is unavailable")
	}
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return 0, errors.New("missing plugin session channel")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.accepting {
		return 0, errors.New("plugin session admission is closed")
	}
	if hasCredential {
		if previous := r.credentials[credentialHash]; previous != nil && previous.state == pluginSessionActive {
			return 0, errors.New("plugin session credential is already active")
		}
	}
	if previous := r.active[channelID]; previous != nil && previous.state == pluginSessionActive {
		return 0, errors.New("plugin session channel is already active")
	}

	r.next++
	generation := r.next
	if bind != nil {
		if err := bind(generation); err != nil {
			return 0, err
		}
	}
	metaCopy := meta
	record := &pluginSessionRecord{
		generation:      generation,
		meta:            metaCopy,
		accessSessionID: strings.TrimSpace(accessSessionID),
		credentialHash:  credentialHash,
		hasCredential:   hasCredential,
		state:           pluginSessionActive,
		drained:         make(chan struct{}),
	}
	r.byGeneration[record.generation] = record
	r.active[channelID] = record
	if record.hasCredential {
		r.credentials[credentialHash] = record
	}
	return record.generation, nil
}

func (r *authenticatedPluginSessionRegistry) activeGeneration(channelID string) (PluginSessionGeneration, bool) {
	if r == nil {
		return 0, false
	}
	channelID = strings.TrimSpace(channelID)
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.active[channelID]
	if record == nil || record.state != pluginSessionActive {
		return 0, false
	}
	return record.generation, true
}

func (r *authenticatedPluginSessionRegistry) acquireChannel(channelID string) (*session.Meta, func(), bool) {
	if r == nil {
		return nil, nil, false
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return nil, nil, false
	}
	r.mu.Lock()
	record := r.active[channelID]
	meta, release, ok := r.acquireLocked(record)
	r.mu.Unlock()
	return meta, release, ok
}

func (r *authenticatedPluginSessionRegistry) resolveChannel(channelID string) (*session.Meta, bool) {
	if r == nil {
		return nil, false
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return nil, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.active[channelID]
	if !r.accepting || record == nil || record.state != pluginSessionActive {
		return nil, false
	}
	metaCopy := record.meta
	return &metaCopy, true
}

func (r *authenticatedPluginSessionRegistry) acquireCredential(credential string) (string, *session.Meta, func(), bool) {
	if r == nil {
		return "", nil, nil, false
	}
	credential = strings.TrimSpace(credential)
	if credential == "" {
		return "", nil, nil, false
	}
	candidate := sha256.Sum256([]byte(credential))

	r.mu.Lock()
	record := r.credentials[candidate]
	if record == nil || !record.hasCredential || subtle.ConstantTimeCompare(candidate[:], record.credentialHash[:]) != 1 {
		r.mu.Unlock()
		return "", nil, nil, false
	}
	meta, release, ok := r.acquireLocked(record)
	r.mu.Unlock()
	if !ok {
		return "", nil, nil, false
	}
	return strings.TrimSpace(meta.ChannelID), meta, release, true
}

func (r *authenticatedPluginSessionRegistry) acquireLocked(record *pluginSessionRecord) (*session.Meta, func(), bool) {
	if !r.accepting || record == nil || record.state != pluginSessionActive {
		return nil, nil, false
	}
	record.admissions++
	metaCopy := record.meta
	var once sync.Once
	release := func() {
		once.Do(func() { r.release(record.generation) })
	}
	return &metaCopy, release, true
}

func (r *authenticatedPluginSessionRegistry) release(generation PluginSessionGeneration) {
	if r == nil || generation == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.byGeneration[generation]
	if record == nil || record.admissions == 0 {
		return
	}
	record.admissions--
	if record.state != pluginSessionActive && record.admissions == 0 {
		r.closeDrainedLocked(record)
	}
}

func (r *authenticatedPluginSessionRegistry) retire(generation PluginSessionGeneration) bool {
	if r == nil || generation == 0 {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.byGeneration[generation]
	if record == nil {
		return false
	}
	if record.state == pluginSessionTerminal {
		return true
	}
	r.retireLocked(record)
	return true
}

func (r *authenticatedPluginSessionRegistry) beginClose(generation PluginSessionGeneration) (*session.Meta, bool) {
	if r == nil || generation == 0 {
		return nil, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.byGeneration[generation]
	if record == nil || record.closeStarted {
		return nil, false
	}
	r.retireLocked(record)
	record.closeStarted = true
	metaCopy := record.meta
	return &metaCopy, true
}

func (r *authenticatedPluginSessionRegistry) retireAccessSession(accessSessionID string) []pluginSessionClose {
	if r == nil {
		return nil
	}
	accessSessionID = strings.TrimSpace(accessSessionID)
	if accessSessionID == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var closes []pluginSessionClose
	for _, record := range r.byGeneration {
		if record == nil || record.state != pluginSessionActive || record.accessSessionID != accessSessionID {
			continue
		}
		r.retireLocked(record)
		closes = append(closes, pluginSessionClose{generation: record.generation, channelID: strings.TrimSpace(record.meta.ChannelID)})
	}
	return closes
}

func (r *authenticatedPluginSessionRegistry) retireLocked(record *pluginSessionRecord) {
	if record == nil || record.state != pluginSessionActive {
		return
	}
	record.state = pluginSessionRetired
	channelID := strings.TrimSpace(record.meta.ChannelID)
	if r.active[channelID] == record {
		delete(r.active, channelID)
	}
	if record.hasCredential && r.credentials[record.credentialHash] == record {
		delete(r.credentials, record.credentialHash)
	}
	if record.admissions == 0 {
		r.closeDrainedLocked(record)
	}
}

func (r *authenticatedPluginSessionRegistry) stopAdmission() []PluginSessionGeneration {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.accepting = false
	generations := make([]PluginSessionGeneration, 0, len(r.active))
	for _, record := range r.active {
		generations = append(generations, record.generation)
		r.retireLocked(record)
	}
	return generations
}

func (r *authenticatedPluginSessionRegistry) waitDrained(ctx context.Context, generation PluginSessionGeneration) error {
	if r == nil || generation == 0 {
		return errors.New("plugin session generation is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.Lock()
	record := r.byGeneration[generation]
	if record == nil {
		r.mu.Unlock()
		return nil
	}
	drained := record.drained
	r.mu.Unlock()
	select {
	case <-drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *authenticatedPluginSessionRegistry) terminalize(generation PluginSessionGeneration) bool {
	if r == nil || generation == 0 {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.byGeneration[generation]
	if record == nil {
		return true
	}
	if record.state == pluginSessionActive || record.admissions != 0 {
		return false
	}
	record.state = pluginSessionTerminal
	return true
}

func (r *authenticatedPluginSessionRegistry) discardTerminal(generation PluginSessionGeneration) bool {
	if r == nil || generation == 0 {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.byGeneration[generation]
	if record == nil {
		return true
	}
	if record.state != pluginSessionTerminal || record.admissions != 0 {
		return false
	}
	delete(r.byGeneration, generation)
	return true
}

func (r *authenticatedPluginSessionRegistry) closeDrainedLocked(record *pluginSessionRecord) {
	if record == nil || record.drainClosed {
		return
	}
	record.drainClosed = true
	close(record.drained)
}

func (a *Agent) AcquirePluginSession(channelID string) (*session.Meta, func(), bool) {
	if a == nil || a.pluginSessions == nil {
		return nil, nil, false
	}
	return a.pluginSessions.acquireChannel(channelID)
}

func (a *Agent) ResolvePluginSession(channelID string) (*session.Meta, bool) {
	if a == nil || a.pluginSessions == nil {
		return nil, false
	}
	return a.pluginSessions.resolveChannel(channelID)
}

func (a *Agent) ResolvePluginSessionCredential(credential string) (string, bool) {
	channelID, _, release, ok := a.AcquirePluginSessionCredential(credential)
	if !ok {
		return "", false
	}
	release()
	return channelID, true
}

func (a *Agent) AcquirePluginSessionCredential(credential string) (string, *session.Meta, func(), bool) {
	if a == nil || a.pluginSessions == nil {
		return "", nil, nil, false
	}
	return a.pluginSessions.acquireCredential(credential)
}

func (a *Agent) RetirePluginSession(generation PluginSessionGeneration) bool {
	return a != nil && a.pluginSessions != nil && a.pluginSessions.retire(generation)
}

func (a *Agent) WaitPluginSessionDrained(ctx context.Context, generation PluginSessionGeneration) error {
	if a == nil || a.pluginSessions == nil {
		return errors.New("plugin session registry is unavailable")
	}
	return a.pluginSessions.waitDrained(ctx, generation)
}

func (a *Agent) TerminalizePluginSession(generation PluginSessionGeneration) bool {
	return a != nil && a.pluginSessions != nil && a.pluginSessions.terminalize(generation)
}

func (a *Agent) activatePluginSession(meta session.Meta, credentialHash [sha256.Size]byte, hasCredential bool, accessSessionID string) (PluginSessionGeneration, error) {
	if a == nil || a.pluginSessions == nil || a.pluginSessionLifecycle == nil {
		return 0, errors.New("plugin session lifecycle is unavailable")
	}
	return a.pluginSessions.registerCredentialHashBound(meta, credentialHash, hasCredential, accessSessionID, func(generation PluginSessionGeneration) error {
		return a.pluginSessionLifecycle.BindPluginSessionGeneration(
			context.Background(),
			&meta,
			a.pluginProcessGeneration,
			pluginSessionGenerationID(generation),
		)
	})
}

func pluginSessionGenerationID(generation PluginSessionGeneration) string {
	return fmt.Sprintf("session-%d", generation)
}

func (a *Agent) EndPluginSession(channelID string) {
	if a == nil || a.pluginSessions == nil {
		return
	}
	generation, ok := a.pluginSessions.activeGeneration(channelID)
	if !ok {
		return
	}
	a.startPluginSessionClose(channelID, generation)
}

func (a *Agent) EndPluginAccessSession(accessSessionID string) {
	if a == nil || a.pluginSessions == nil {
		return
	}
	for _, closeRequest := range a.pluginSessions.retireAccessSession(accessSessionID) {
		a.startPluginSessionClose(closeRequest.channelID, closeRequest.generation)
	}
}
