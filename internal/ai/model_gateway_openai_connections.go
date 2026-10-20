package ai

import (
	"bytes"
	"context"
	"crypto/rand"
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

	wire "github.com/coder/websocket"
	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	responses "github.com/openai/openai-go/v3/responses"
)

const openAIWebSocketMaxMessageBytes = 8 << 20
const openAIWebSocketConnectTimeout = 15 * time.Second

var errOpenAIThreadSSE = errors.New("thread uses HTTP streaming")

type openAIConnectionIdentity struct{ Provider, Endpoint, Account string }
type openAIThreadRoute struct {
	openAIConnectionIdentity
	ThreadID string
}

type openAIConnectionKey struct {
	openAIConnectionIdentity
	Model, Scope string
}

func normalizedOpenAIEndpoint(endpoint string) string {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if endpoint == "" {
		return "https://api.openai.com/v1"
	}
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		u.Scheme = strings.ToLower(u.Scheme)
		u.Host = strings.ToLower(u.Host)
		if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
			u.Host = u.Hostname()
			if strings.Contains(u.Host, ":") {
				u.Host = "[" + u.Host + "]"
			}
		}
		return u.String()
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
	selections     map[openAIThreadRoute]*openAITransportSelection
	changed        chan struct{}
	closed         bool
	capacity       int
	idle, lifetime time.Duration
}

// The pool mutex owns both selection changes and generation-send admission.
// An admitted write is in flight; cancellation never waits for network I/O.
type openAITransportSelection struct {
	reason string // guarded by the pool mutex
}

type openAIConnection struct {
	threadID                                        string
	measurementID                                   string
	reasoningIncluded                               bool
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
	route     openAIThreadRoute
	selection *openAITransportSelection
	pool      *openAIResponsesPool
	key       openAIConnectionKey
	entry     *openAIConnection
	ctx       context.Context
	cancel    context.CancelFunc
	stopAbort func() bool
	finished  bool // guarded by the pool mutex
}

func newOpenAIResponsesPool() *openAIResponsesPool {
	return &openAIResponsesPool{selections: map[openAIThreadRoute]*openAITransportSelection{}, entries: map[openAIConnectionKey]*openAIConnection{}, changed: make(chan struct{}), capacity: 16, idle: 5 * time.Minute, lifetime: 55 * time.Minute}
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
	clear(p.selections)
	for k, e := range p.entries {
		p.dropLocked(k, e)
	}
	p.signalLocked()
}

var errOpenAIPoolFull = errors.New("OpenAI connection pool is full")
var errOpenAIPoolClosed = errors.New("OpenAI connection pool is closed")

func (p *openAIResponsesPool) acquire(ctx context.Context, key openAIConnectionKey, bearer, threadID string) (*openAIConnectionLease, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		p.mu.Lock()
		if err := ctx.Err(); err != nil {
			p.mu.Unlock()
			return nil, err
		}
		if p.closed {
			p.mu.Unlock()
			return nil, errOpenAIPoolClosed
		}
		route := openAIThreadRoute{key.openAIConnectionIdentity, threadID}
		if selection := p.selections[route]; selection != nil && selection.reason != "" {
			p.mu.Unlock()
			return nil, errOpenAIThreadSSE
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
			e = &openAIConnection{threadID: threadID, measurementID: rand.Text(), opened: time.Now(), auth: sha256.Sum256([]byte(bearer))}
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
	if l.finished {
		return
	}
	if p.entries[l.key] != e {
		l.finished = true
		l.cancel()
		return
	}
	if !success || l.ctx.Err() != nil {
		l.retireLocked()
		return
	}
	l.finished = true
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

// retireLocked is the single cancellation boundary for an active socket.
func (l *openAIConnectionLease) retireLocked() {
	p := l.pool
	if l.finished || p.entries[l.key] != l.entry {
		return
	}
	l.finished = true
	var timeout *flprovider.RequestTimeoutError
	if errors.As(context.Cause(l.ctx), &timeout) && l.selection != nil && p.selections[l.route] == l.selection && l.selection.reason == "" {
		l.selection.reason = "request_timeout"
	}
	p.dropLocked(l.key, l.entry)
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
// sends exactly one response.create and reports failures to the Engine.
type openAIResponsesEvents interface {
	Next() bool
	Current() responses.ResponseStreamEventUnion
	Err() error
	Close() error
}
type openAIWebSocketEvents struct {
	lease         *openAIConnectionLease
	diagnostic    *providerAttemptDiagnostic
	command       map[string]json.RawMessage
	current       responses.ResponseStreamEventUnion
	err           error
	done, started bool
}

func (s *openAIWebSocketEvents) Current() responses.ResponseStreamEventUnion { return s.current }
func (s *openAIWebSocketEvents) Err() error                                  { return s.err }
func (s *openAIWebSocketEvents) Close() error                                { return nil }
func (s *openAIWebSocketEvents) send(body map[string]json.RawMessage) error {
	p := s.lease.pool
	p.mu.Lock()
	valid := !p.closed && s.lease.selection != nil && p.selections[s.lease.route] == s.lease.selection && p.entries[s.lease.key] == s.lease.entry
	pinned := s.lease.selection != nil && s.lease.selection.reason != ""
	p.mu.Unlock()
	if !valid || s.lease.ctx.Err() != nil {
		return context.Canceled
	}
	if pinned {
		return errOpenAIThreadSSE
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	s.diagnostic.RequestBytes = len(raw)
	return s.lease.entry.conn.Create(s.lease.ctx, param.Override[responses.ResponsesClientEventResponseCreateParam](json.RawMessage(raw)))
}
func openAIWebSocketFailure(err error) error {
	var adviser flprovider.RetryAdviser
	if errors.As(err, &adviser) || errors.Is(err, context.Canceled) {
		return err
	}
	switch wire.CloseStatus(err) {
	case wire.StatusNormalClosure, wire.StatusGoingAway, wire.StatusAbnormalClosure, wire.StatusNoStatusRcvd, wire.StatusInternalError, wire.StatusServiceRestart, wire.StatusTryAgainLater:
		return flprovider.WithRetryAdvice(err, flprovider.RetryAdvice{Category: flprovider.RetryStreamInterrupted})
	case wire.StatusProtocolError, wire.StatusUnsupportedData, wire.StatusInvalidFramePayloadData, wire.StatusPolicyViolation, wire.StatusMessageTooBig, wire.StatusMandatoryExtension:
		return flprovider.WithRetryAdvice(err, flprovider.RetryAdvice{Category: flprovider.RetryPermanent})
	default:
		return err
	}
}

func (s *openAIWebSocketEvents) Next() bool {
	if s.done || s.err != nil {
		return false
	}
	for {
		event, err := s.lease.entry.conn.Recv(s.lease.ctx)
		if err != nil {
			err = openAIWebSocketFailure(err)
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
		if failure.Type == "error" && !s.started && s.command["previous_response_id"] != nil && failure.Error.Code == "previous_response_not_found" {
			s.diagnostic.firstEvent(true)
			s.err = flprovider.WithRetryAdvice(errOpenAIStaleResponse, flprovider.RetryAdvice{Category: flprovider.RetryStreamInterrupted})
			return false
		}
		if failure.Type != "response.created" && failure.Type != "response.in_progress" {
			s.started = true
		}
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
func (l *openAIConnectionLease) command(payload []byte, req ModelGatewayRequest) (map[string]json.RawMessage, error) {
	body, input, settings, err := openAIWireParts(payload)
	if err != nil {
		return nil, err
	}
	body["type"] = json.RawMessage(`"response.create"`)
	e := l.entry
	if req.ReusePolicy != nil && req.ReusePolicy.ProviderStateAllowed && req.ReusePolicy.PreferContinuation && req.PreviousState != nil && e.responseID != "" && req.PreviousState.Attributes["response_id"] == e.responseID && openAIHash(req.PreviousState) == e.stateHash && settings == e.settingsHash && len(input) >= e.prefixCount {
		prefix, err := normalizedInputHash(input[:e.prefixCount])
		if err != nil {
			return nil, err
		}
		if prefix == e.prefixHash {
			body["previous_response_id"], _ = json.Marshal(e.responseID)
			body["input"], _ = json.Marshal(input[e.prefixCount:])
		}
	}
	return body, nil
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
func (p *openAIProvider) responsesStream(ctx context.Context, req ModelGatewayRequest, bearer string, payload []byte, response **http.Response, options []option.RequestOption, diag *providerAttemptDiagnostic) (openAIResponsesEvents, *openAIConnectionLease, string, error) {
	key := openAIConnectionKey{p.transportIdentity, req.Model, string(req.PromptScopeID)}
	if req.ReusePolicy != nil && !req.ReusePolicy.ProviderStateAllowed {
		p.responsesPool.invalidate(key)
	}
	fallback := ""
	route := openAIRequestRoute(p.transportIdentity, req)
	eligible := p.chatGPT && p.officialOpenAI && p.responsesPool != nil && key.Scope != "" && route.ThreadID != "" && (req.ReusePolicy == nil || req.ReusePolicy.ProviderStateAllowed)
	if eligible && p.responsesPool.selection(route) != "" {
		eligible = false
		fallback = "thread_sse"
	}
	if eligible && len(payload) > openAIWebSocketMaxMessageBytes-1024 {
		eligible = false
		fallback = "message_limit"
	}
	if eligible {
		lease, err := p.responsesPool.acquire(ctx, key, bearer, req.ThreadID.String())
		if errors.Is(err, errOpenAIThreadSSE) {
			fallback = "thread_sse"
		} else if errors.Is(err, errOpenAIPoolFull) {
			fallback = "pool_capacity"
		} else if err != nil {
			return nil, nil, "", err
		} else {
			lease.route = route
			lease.selection = diag.selection
			// The same lease owner retires connect and receive cancellation.
			lease.stopAbort = context.AfterFunc(lease.ctx, func() {
				p.responsesPool.mu.Lock()
				defer p.responsesPool.mu.Unlock()
				lease.retireLocked()
			})
			diag.observe(flprovider.TransportWebSocket, flprovider.TransportConnecting, "", "")
			if lease.entry.conn == nil {
				var handshake *http.Response
				connectOpts := []option.RequestOption{option.WithAPIKey(bearer), option.WithMaxRetries(0), option.WithMiddleware(func(r *http.Request, next option.MiddlewareNext) (*http.Response, error) {
					res, err := next(r)
					markProviderResponseReceived(res)
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
				connectCtx, cancelConnect := context.WithTimeout(lease.ctx, openAIWebSocketConnectTimeout)
				connectStarted := time.Now()
				conn, err := p.client.Responses.Connect(connectCtx, responses.ResponseConnectionOptions{MaxMessageBytes: openAIWebSocketMaxMessageBytes, MaxBufferedBytes: 16 << 20, MaxBufferedEvents: 1024, MaxPendingSends: 1, MaxLanes: 1, CloseTimeout: time.Second}, connectOpts...)
				elapsed := time.Since(connectStarted).Milliseconds()
				diag.ConnectMS = &elapsed
				cancelConnect()
				if err != nil {
					defer lease.finish(false)
					*response = handshake
					failure := providerRequestFailure(err, handshake, p.failureProviderType())
					if ctx.Err() == nil && handshake != nil && (handshake.StatusCode == 404 || handshake.StatusCode == 405 || handshake.StatusCode == 426 || handshake.StatusCode == 501) {
						diag.switchToSSE("upgrade_unsupported")
						return nil, nil, "", flprovider.WithRetryAdvice(failure, flprovider.RetryAdvice{Category: flprovider.RetryTransient})
					}
					if ctx.Err() == nil && recoverableWebSocketTransport(err) {
						reason := "connect_failed"
						if errors.Is(err, context.DeadlineExceeded) {
							reason = "connect_timeout"
						}
						diag.switchToSSE(reason)
					}
					return nil, nil, "", failure
				} else if err = lease.install(conn, p.chatGPTWatch); err != nil {
					lease.finish(false)
					return nil, nil, "", err
				}
				if err == nil && handshake != nil {
					diag.HTTPStatus = handshake.StatusCode
					diag.RequestID = handshake.Header.Get("x-request-id")
					p.responsesPool.mu.Lock()
					lease.entry.reasoningIncluded = handshake.Header.Values("x-reasoning-included") != nil
					p.responsesPool.mu.Unlock()
				}
			}
			if fallback == "" {
				command, err := lease.command(payload, req)
				if err != nil {
					lease.finish(false)
					return nil, nil, "", err
				}
				stream := &openAIWebSocketEvents{lease: lease, diagnostic: diag, command: command}
				diag.observe(flprovider.TransportWebSocket, flprovider.TransportSending, "", "")
				if err = stream.send(command); err != nil {
					if ctx.Err() == nil && recoverableWebSocketTransport(err) {
						diag.switchToSSE("connection_lost")
					}
					lease.finish(false)
					if errors.Is(err, errOpenAIThreadSSE) {
						diag.observe(flprovider.TransportHTTPSSE, flprovider.TransportSending, "", "")
						return p.client.Responses.NewStreaming(ctx, responses.ResponseNewParams{}, options...), nil, "thread_sse", nil
					}
					return nil, nil, "", err
				}
				return stream, lease, "", nil
			}
		}
	}
	diag.observe(flprovider.TransportHTTPSSE, flprovider.TransportSending, "", "")
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

func openAIRequestRoute(identity openAIConnectionIdentity, req ModelGatewayRequest) openAIThreadRoute {
	return openAIThreadRoute{identity, req.ThreadID.String()}
}
func (p *openAIResponsesPool) selection(route openAIThreadRoute) string {
	if p == nil || route.ThreadID == "" {
		return ""
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if selection := p.selections[route]; selection != nil {
		return selection.reason
	}
	return ""
}
func (p *openAIResponsesPool) routeSelection(ctx context.Context, route openAIThreadRoute) *openAITransportSelection {
	if p == nil || route.ThreadID == "" {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || ctx.Err() != nil {
		return nil
	}
	if p.selections[route] == nil {
		p.selections[route] = &openAITransportSelection{}
	}
	return p.selections[route]
}
func (p *openAIResponsesPool) selectSSE(route openAIThreadRoute, selection *openAITransportSelection, reason string) string {
	if p == nil || selection == nil {
		return ""
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || p.selections[route] != selection {
		return ""
	}
	if selection.reason == "" {
		selection.reason = reason
		p.signalLocked()
	}
	return selection.reason
}
func (p *openAIResponsesPool) releaseThread(threadID string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for route := range p.selections {
		if route.ThreadID == threadID {
			delete(p.selections, route)
		}
	}
	for key, e := range p.entries {
		if e.threadID == threadID {
			p.dropLocked(key, e)
		}
	}
}
func (p *openAIResponsesPool) closeConnections() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for key, e := range p.entries {
		p.dropLocked(key, e)
	}
}
