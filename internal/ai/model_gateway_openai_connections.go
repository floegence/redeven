package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	responses "github.com/openai/openai-go/v3/responses"
)

const openAIWebSocketMaxMessageBytes = 8 << 20

type openAIConnectionIdentity struct{ Provider, Endpoint, Account string }
type openAIConnectionKey struct {
	openAIConnectionIdentity
	Model, Scope string
}

func normalizedOpenAIEndpoint(endpoint string) string {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if endpoint == "" {
		return "https://api.openai.com/v1"
	}
	return endpoint
}
func isOfficialOpenAIEndpoint(provider, endpoint string) bool {
	u, err := url.Parse(normalizedOpenAIEndpoint(endpoint))
	return err == nil && provider == "openai" && u.Scheme == "https" && u.Host == "api.openai.com" && u.Path == "/v1" && u.RawQuery == "" && u.Fragment == "" && u.User == nil
}
func openAIPromptCacheKey(namespace string, identity openAIConnectionIdentity) string {
	raw, _ := json.Marshal([]string{"redeven-openai-v1", namespace, identity.Provider, identity.Endpoint, identity.Account})
	sum := sha256.Sum256(raw)
	return "rdv_" + hex.EncodeToString(sum[:])
}
func openAIHash(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

type openAIResponsesPool struct {
	mu             sync.Mutex
	entries        map[openAIConnectionKey]*openAIConnection
	changed        chan struct{}
	closed         bool
	capacity       int
	idle, lifetime time.Duration
}
type openAIConnection struct {
	conn                                            *responses.ResponseConnection
	busy                                            bool
	opened                                          time.Time
	auth                                            [32]byte
	cancel                                          context.CancelFunc
	stopWatch                                       func()
	timer                                           *time.Timer
	responseID, stateHash, settingsHash, prefixHash string
	prefixCount                                     int
}
type openAIConnectionLease struct {
	pool      *openAIResponsesPool
	key       openAIConnectionKey
	entry     *openAIConnection
	ctx       context.Context
	cancel    context.CancelFunc
	stopAbort func() bool
}

func newOpenAIResponsesPool() *openAIResponsesPool {
	return &openAIResponsesPool{entries: map[openAIConnectionKey]*openAIConnection{}, changed: make(chan struct{}), capacity: 16, idle: 5 * time.Minute, lifetime: 55 * time.Minute}
}
func (p *openAIResponsesPool) signalLocked() { close(p.changed); p.changed = make(chan struct{}) }
func (p *openAIResponsesPool) dropLocked(key openAIConnectionKey, e *openAIConnection) {
	if p.entries[key] != e {
		return
	}
	delete(p.entries, key)
	if e.timer != nil {
		e.timer.Stop()
	}
	if e.cancel != nil {
		e.cancel()
	}
	if e.stopWatch != nil {
		e.stopWatch()
	}
	if e.conn != nil {
		e.conn.Abort()
	}
	p.signalLocked()
}
func (p *openAIResponsesPool) invalidate(key openAIConnectionKey) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := p.entries[key]; e != nil {
		p.dropLocked(key, e)
	}
}
func (p *openAIResponsesPool) Close() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	for k, e := range p.entries {
		p.dropLocked(k, e)
	}
	p.signalLocked()
}

var errOpenAIPoolFull = errors.New("OpenAI connection pool is full")
var errOpenAIPoolClosed = errors.New("OpenAI connection pool is closed")

func (p *openAIResponsesPool) acquire(ctx context.Context, key openAIConnectionKey, bearer string) (*openAIConnectionLease, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		p.mu.Lock()
		if p.closed {
			p.mu.Unlock()
			return nil, errOpenAIPoolClosed
		}
		e := p.entries[key]
		if e != nil && e.busy {
			changed := p.changed
			p.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-changed:
				continue
			}
		}
		if e != nil && (time.Since(e.opened) >= p.lifetime || e.auth != sha256.Sum256([]byte(bearer))) {
			p.dropLocked(key, e)
			e = nil
		}
		if e == nil {
			if len(p.entries) >= p.capacity {
				p.mu.Unlock()
				return nil, errOpenAIPoolFull
			}
			e = &openAIConnection{opened: time.Now(), auth: sha256.Sum256([]byte(bearer))}
			p.entries[key] = e
		}
		if e.timer != nil {
			e.timer.Stop()
			e.timer = nil
		}
		runCtx, cancel := context.WithCancel(ctx)
		e.busy = true
		e.cancel = cancel
		lease := &openAIConnectionLease{pool: p, key: key, entry: e, ctx: runCtx, cancel: cancel}
		p.mu.Unlock()
		return lease, nil
	}
}
func (l *openAIConnectionLease) finish(success bool) {
	if l.stopAbort != nil {
		l.stopAbort()
	}
	p := l.pool
	p.mu.Lock()
	defer p.mu.Unlock()
	e := l.entry
	if p.entries[l.key] != e {
		l.cancel()
		return
	}
	if !success || l.ctx.Err() != nil {
		p.dropLocked(l.key, e)
		return
	}
	e.busy = false
	e.cancel = nil
	l.cancel()
	e.timer = time.AfterFunc(p.idle, func() {
		p.mu.Lock()
		defer p.mu.Unlock()
		if p.entries[l.key] == e && !e.busy {
			p.dropLocked(l.key, e)
		}
	})
	p.signalLocked()
}
func (l *openAIConnectionLease) install(conn *responses.ResponseConnection, watch func(context.Context, func(error)) (func(), error)) error {
	p := l.pool
	p.mu.Lock()
	if p.entries[l.key] != l.entry || l.ctx.Err() != nil {
		p.mu.Unlock()
		conn.Abort()
		return context.Canceled
	}
	l.entry.conn = conn
	p.mu.Unlock()
	if watch != nil {
		stop, err := watch(context.Background(), func(error) { p.mu.Lock(); defer p.mu.Unlock(); p.dropLocked(l.key, l.entry) })
		if err != nil {
			return err
		}
		p.mu.Lock()
		if p.entries[l.key] != l.entry {
			p.mu.Unlock()
			stop()
			return context.Canceled
		}
		l.entry.stopWatch = stop
		p.mu.Unlock()
	}
	return nil
}

// HTTP and WebSocket feed this same Responses event consumer. The socket adapter
// only handles response.create and the one explicit stale-response rejection.
type openAIResponsesEvents interface {
	Next() bool
	Current() responses.ResponseStreamEventUnion
	Err() error
	Close() error
}
type openAIWebSocketEvents struct {
	lease                  *openAIConnectionLease
	full, command          map[string]json.RawMessage
	current                responses.ResponseStreamEventUnion
	err                    error
	done, started, retried bool
}

func (s *openAIWebSocketEvents) Current() responses.ResponseStreamEventUnion { return s.current }
func (s *openAIWebSocketEvents) Err() error                                  { return s.err }
func (s *openAIWebSocketEvents) Close() error                                { return nil }
func (s *openAIWebSocketEvents) send(body map[string]json.RawMessage) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return s.lease.entry.conn.Create(s.lease.ctx, param.Override[responses.ResponsesClientEventResponseCreateParam](json.RawMessage(raw)))
}
func (s *openAIWebSocketEvents) Next() bool {
	if s.done || s.err != nil {
		return false
	}
	for {
		event, err := s.lease.entry.conn.Recv(s.lease.ctx)
		if err != nil {
			s.err = err
			return false
		}
		raw := event.RawJSON()
		var failure struct {
			Type  string `json:"type"`
			Error struct {
				Code  string `json:"code"`
				Param string `json:"param"`
			} `json:"error"`
		}
		if err = json.Unmarshal([]byte(raw), &failure); err != nil {
			s.err = err
			return false
		}
		if failure.Type == "error" && !s.started && !s.retried && s.command["previous_response_id"] != nil && failure.Error.Code == "previous_response_not_found" {
			s.retried = true
			s.lease.entry.responseID = ""
			s.lease.entry.stateHash = ""
			s.command = s.full
			if s.err = s.send(s.full); s.err != nil {
				return false
			}
			continue
		}
		s.started = true
		if err = json.Unmarshal([]byte(raw), &s.current); err != nil {
			s.err = err
			return false
		}
		switch s.current.Type {
		case "response.completed", "response.failed", "response.incomplete", "error":
			s.done = true
		}
		return true
	}
}
func openAIWireParts(payload []byte) (map[string]json.RawMessage, []json.RawMessage, string, error) {
	var body map[string]json.RawMessage
	if err := json.Unmarshal(payload, &body); err != nil {
		return nil, nil, "", err
	}
	var input []json.RawMessage
	if err := json.Unmarshal(body["input"], &input); err != nil {
		return nil, nil, "", err
	}
	delete(body, "stream")
	delete(body, "background")
	delete(body, "previous_response_id")
	settings := make(map[string]json.RawMessage, len(body))
	for k, v := range body {
		if k != "input" {
			settings[k] = v
		}
	}
	return body, input, openAIHash(settings), nil
}
func normalizedInputHash(input []json.RawMessage) (string, error) {
	values := make([]any, len(input))
	for i, raw := range input {
		if err := json.Unmarshal(raw, &values[i]); err != nil {
			return "", err
		}
	}
	return openAIHash(values), nil
}
func (l *openAIConnectionLease) command(payload []byte, req ModelGatewayRequest) (map[string]json.RawMessage, map[string]json.RawMessage, error) {
	body, input, settings, err := openAIWireParts(payload)
	if err != nil {
		return nil, nil, err
	}
	body["type"] = json.RawMessage(`"response.create"`)
	full := make(map[string]json.RawMessage, len(body))
	for k, v := range body {
		full[k] = v
	}
	e := l.entry
	if req.ReusePolicy != nil && req.ReusePolicy.ProviderStateAllowed && req.ReusePolicy.PreferContinuation && req.PreviousState != nil && e.responseID != "" && req.PreviousState.Attributes["response_id"] == e.responseID && openAIHash(req.PreviousState) == e.stateHash && settings == e.settingsHash && len(input) >= e.prefixCount {
		prefix, err := normalizedInputHash(input[:e.prefixCount])
		if err != nil {
			return nil, nil, err
		}
		if prefix == e.prefixHash {
			body["previous_response_id"], _ = json.Marshal(e.responseID)
			body["input"], _ = json.Marshal(input[e.prefixCount:])
		}
	}
	return full, body, nil
}
func (l *openAIConnectionLease) confirm(payload []byte, response responses.Response, state *ModelGatewayState) error {
	e := l.entry
	e.responseID = ""
	e.stateHash = ""
	if state == nil || response.ID == "" || response.Status != "completed" {
		return nil
	}
	_, input, settings, err := openAIWireParts(payload)
	if err != nil {
		return err
	}
	for _, item := range response.Output {
		input = append(input, json.RawMessage(item.RawJSON()))
	}
	prefix, err := normalizedInputHash(input)
	if err != nil {
		return err
	}
	e.responseID = response.ID
	e.stateHash = openAIHash(state)
	e.prefixHash = prefix
	e.prefixCount = len(input)
	e.settingsHash = settings
	return nil
}
func (p *openAIProvider) responsesStream(ctx context.Context, req ModelGatewayRequest, bearer string, payload []byte, response **http.Response, options []option.RequestOption) (openAIResponsesEvents, *openAIConnectionLease, string, error) {
	key := openAIConnectionKey{p.transportIdentity, req.Model, string(req.PromptScopeID)}
	if req.ReusePolicy != nil && !req.ReusePolicy.ProviderStateAllowed {
		p.responsesPool.invalidate(key)
	}
	fallback := ""
	eligible := p.chatGPT && p.officialOpenAI && p.responsesPool != nil && key.Scope != "" && (req.ReusePolicy == nil || req.ReusePolicy.ProviderStateAllowed)
	if eligible && len(payload) > openAIWebSocketMaxMessageBytes-1024 {
		eligible = false
		fallback = "message_limit"
	}
	if eligible {
		lease, err := p.responsesPool.acquire(ctx, key, bearer)
		if errors.Is(err, errOpenAIPoolFull) {
			fallback = "pool_capacity"
		} else if err != nil {
			return nil, nil, "", err
		} else {
			if lease.entry.conn == nil {
				var handshake *http.Response
				connectOpts := []option.RequestOption{option.WithAPIKey(bearer), option.WithMaxRetries(0), option.WithMiddleware(func(r *http.Request, next option.MiddlewareNext) (*http.Response, error) {
					res, err := next(r)
					handshake = res
					if res != nil && res.StatusCode >= 400 && res.Body != nil {
						raw, readErr := io.ReadAll(io.LimitReader(res.Body, 64<<10))
						_ = res.Body.Close()
						if readErr != nil {
							return nil, readErr
						}
						res.Body = io.NopCloser(bytes.NewReader(raw))
						snapshot := *res
						snapshot.Body = io.NopCloser(bytes.NewReader(raw))
						handshake = &snapshot
					}
					return res, err
				})}
				conn, err := p.client.Responses.Connect(lease.ctx, responses.ResponseConnectionOptions{MaxMessageBytes: openAIWebSocketMaxMessageBytes, MaxBufferedBytes: 16 << 20, MaxBufferedEvents: 1024, MaxPendingSends: 1, MaxLanes: 1, CloseTimeout: time.Second}, connectOpts...)
				if err != nil {
					lease.finish(false)
					if handshake != nil && (handshake.StatusCode == http.StatusNotFound || handshake.StatusCode == http.StatusMethodNotAllowed || handshake.StatusCode == http.StatusUpgradeRequired || handshake.StatusCode == http.StatusNotImplemented) {
						fallback = "upgrade_unsupported"
					} else {
						*response = handshake
						return nil, nil, "", err
					}
				} else if err = lease.install(conn, p.chatGPTWatch); err != nil {
					lease.finish(false)
					return nil, nil, "", err
				}
			}
			if fallback == "" {
				lease.stopAbort = context.AfterFunc(lease.ctx, func() {
					p.responsesPool.mu.Lock()
					defer p.responsesPool.mu.Unlock()
					p.responsesPool.dropLocked(key, lease.entry)
				})
				full, command, err := lease.command(payload, req)
				if err != nil {
					lease.finish(false)
					return nil, nil, "", err
				}
				stream := &openAIWebSocketEvents{lease: lease, full: full, command: command}
				if err = stream.send(command); err != nil {
					lease.finish(false)
					return nil, nil, "", err
				}
				return stream, lease, "", nil
			}
		}
	}
	stream := p.client.Responses.NewStreaming(ctx, responses.ResponseNewParams{}, options...)
	return stream, nil, fallback, nil
}

// Executors own pools; adapters retain only a reference and immutable routing identity.
func configureOpenAIConnections(adapter ModelGateway, providerID, endpoint, account string, pool *openAIResponsesPool) {
	if p, ok := adapter.(*openAIProvider); ok {
		p.responsesPool = pool
		p.transportIdentity = openAIConnectionIdentity{Provider: providerID, Endpoint: normalizedOpenAIEndpoint(endpoint), Account: account}
	}
}
func (s *Service) openAIConnectionPool() *openAIResponsesPool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.openAIConnections == nil {
		s.openAIConnections = newOpenAIResponsesPool()
		if s.serviceClosing {
			s.openAIConnections.Close()
		}
	}
	return s.openAIConnections
}
