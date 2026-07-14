package ai

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	contextadapter "github.com/floegence/redeven/internal/ai/context/adapter"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/settings"
	"github.com/gorilla/websocket"
)

const (
	DesktopModelSourceProviderType      = "desktop_model_source"
	DesktopModelSourceProtocolVersion   = "redeven-desktop-model-source-rpc-v1"
	DesktopModelSourceDefaultSource     = "desktop_local_environment"
	desktopModelSourceModelIDPrefix     = "desktop:model_"
	defaultDesktopModelSourceRPCTimeout = 30 * time.Second
)

type DesktopModelSourceSession struct {
	SessionID       string
	Source          string
	ProtocolVersion string
	ExpiresAtUnixMS int64
}

type DesktopModelSourceStatus struct {
	BindingState          string   `json:"binding_state,omitempty"`
	Connected             bool     `json:"connected"`
	Available             bool     `json:"available"`
	ModelSource           string   `json:"model_source,omitempty"`
	SessionID             string   `json:"session_id,omitempty"`
	ExpiresAtUnixMS       int64    `json:"expires_at_unix_ms,omitempty"`
	ConnectedAtUnixMS     int64    `json:"connected_at_unix_ms,omitempty"`
	ModelCount            int      `json:"model_count"`
	MissingKeyProviderIDs []string `json:"missing_key_provider_ids,omitempty"`
	LastError             string   `json:"last_error,omitempty"`
}

type AIRuntimeStatus struct {
	RemoteConfigured   bool                      `json:"remote_configured"`
	DesktopModelSource *DesktopModelSourceStatus `json:"desktop_model_source,omitempty"`
}

type DesktopModelSourceModel struct {
	ID                            string                        `json:"id"`
	Label                         string                        `json:"label,omitempty"`
	Provider                      string                        `json:"provider,omitempty"`
	ContextWindow                 int                           `json:"context_window,omitempty"`
	MaxOutputTokens               int                           `json:"max_output_tokens,omitempty"`
	EffectiveContextWindowPercent int                           `json:"effective_context_window_percent,omitempty"`
	InputModalities               []string                      `json:"input_modalities,omitempty"`
	SupportsImageInput            bool                          `json:"supports_image_input,omitempty"`
	ReasoningCapability           config.AIReasoningCapability  `json:"reasoning_capability,omitempty"`
	Capability                    *contextmodel.ModelCapability `json:"capability,omitempty"`
}

type DesktopModelSourceModelSnapshot struct {
	Configured            bool                      `json:"configured"`
	CurrentModel          string                    `json:"current_model"`
	Models                []DesktopModelSourceModel `json:"models"`
	MissingKeyProviderIDs []string                  `json:"missing_key_provider_ids,omitempty"`
}

type DesktopModelSourceConnectorOptions struct {
	Logger                *slog.Logger
	ConfigPath            string
	SecretsPath           string
	RuntimeControlBaseURL string
	RuntimeControlToken   string
	DesktopOwnerID        string
	SessionID             string
	Source                string
	ExpiresAtUnixMS       int64
	StartupReportFile     string
	HTTPClient            *http.Client
}

type DesktopModelSourceStartupReport struct {
	Status                string   `json:"status"`
	SessionID             string   `json:"session_id"`
	PID                   int      `json:"pid"`
	Configured            bool     `json:"configured"`
	ModelCount            int      `json:"model_count"`
	MissingKeyProviderIDs []string `json:"missing_key_provider_ids,omitempty"`
}

type DesktopModelSourceRPCFrame struct {
	ProtocolVersion string                      `json:"protocol_version,omitempty"`
	ID              string                      `json:"id,omitempty"`
	Type            string                      `json:"type"`
	Method          string                      `json:"method,omitempty"`
	Params          json.RawMessage             `json:"params,omitempty"`
	Event           *StreamEvent                `json:"event,omitempty"`
	Result          json.RawMessage             `json:"result,omitempty"`
	Error           *DesktopModelSourceRPCError `json:"error,omitempty"`
}

type DesktopModelSourceRPCError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

func (e *DesktopModelSourceRPCError) Error() string {
	if e == nil {
		return "desktop model source request failed"
	}
	msg := strings.TrimSpace(e.Message)
	if msg == "" {
		msg = strings.TrimSpace(e.Code)
	}
	if msg == "" {
		msg = "desktop model source request failed"
	}
	return msg
}

type desktopModelSourceStreamRequest struct {
	Request ModelGatewayRequest `json:"request"`
}

type desktopModelSourceRegistryEntry struct {
	Model       DesktopModelSourceModel
	ProviderID  string
	ModelName   string
	ProviderCfg config.AIProvider
}

type desktopModelSourceClient struct {
	log *slog.Logger

	mu                sync.Mutex
	session           DesktopModelSourceSession
	conn              *desktopModelSourceRuntimeConn
	connectedAtUnixMS int64
	lastErr           string
	lastSnapshot      *DesktopModelSourceModelSnapshot
	currentModelID    string
}

type desktopModelSourceProvider struct {
	client         *desktopModelSourceClient
	defaultModelID string
}

type desktopModelSourceRuntimeConn struct {
	ws       *websocket.Conn
	writeMu  sync.Mutex
	mu       sync.Mutex
	pending  map[string]chan DesktopModelSourceRPCFrame
	closed   bool
	closeErr error
}

func normalizeDesktopModelSourceSession(session DesktopModelSourceSession) (DesktopModelSourceSession, error) {
	out := DesktopModelSourceSession{
		SessionID:       strings.TrimSpace(session.SessionID),
		Source:          strings.TrimSpace(session.Source),
		ProtocolVersion: strings.TrimSpace(session.ProtocolVersion),
		ExpiresAtUnixMS: session.ExpiresAtUnixMS,
	}
	if out.SessionID == "" {
		return DesktopModelSourceSession{}, errors.New("missing desktop model source session id")
	}
	if out.Source == "" {
		out.Source = DesktopModelSourceDefaultSource
	}
	if out.ProtocolVersion == "" {
		out.ProtocolVersion = DesktopModelSourceProtocolVersion
	}
	if out.ProtocolVersion != DesktopModelSourceProtocolVersion {
		return DesktopModelSourceSession{}, fmt.Errorf("unsupported desktop model source protocol %q", out.ProtocolVersion)
	}
	return out, nil
}

func newDesktopModelSourceClient(log *slog.Logger) *desktopModelSourceClient {
	return &desktopModelSourceClient{log: log}
}

func (c *desktopModelSourceClient) hasBinding() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.TrimSpace(c.session.SessionID) != ""
}

func (c *desktopModelSourceClient) isConnected() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil
}

func (c *desktopModelSourceClient) Prepare(session DesktopModelSourceSession) (*DesktopModelSourceStatus, error) {
	if c == nil {
		return nil, errors.New("nil desktop model source")
	}
	normalized, err := normalizeDesktopModelSourceSession(session)
	if err != nil {
		return nil, err
	}
	var old *desktopModelSourceRuntimeConn
	c.mu.Lock()
	if c.conn != nil && c.session.SessionID != normalized.SessionID {
		old = c.conn
		c.conn = nil
	}
	c.session = normalized
	c.connectedAtUnixMS = 0
	c.lastErr = ""
	c.lastSnapshot = nil
	status := c.statusLocked(time.Now())
	c.mu.Unlock()
	if old != nil {
		old.Close()
	}
	return status, nil
}

func (c *desktopModelSourceClient) ServeRPC(ctx context.Context, session DesktopModelSourceSession, ws *websocket.Conn, onChange func()) error {
	if c == nil {
		return errors.New("nil desktop model source")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ws == nil {
		return errors.New("missing desktop model source websocket")
	}
	normalized, err := normalizeDesktopModelSourceSession(session)
	if err != nil {
		_ = ws.Close()
		return err
	}
	runtimeConn := newDesktopModelSourceRuntimeConn(ws)
	var old *desktopModelSourceRuntimeConn
	c.mu.Lock()
	if c.session.SessionID == normalized.SessionID {
		if normalized.ExpiresAtUnixMS == 0 {
			normalized.ExpiresAtUnixMS = c.session.ExpiresAtUnixMS
		}
		if strings.TrimSpace(normalized.Source) == "" {
			normalized.Source = c.session.Source
		}
	}
	if c.conn != nil {
		old = c.conn
	}
	c.session = normalized
	c.conn = runtimeConn
	c.connectedAtUnixMS = time.Now().UnixMilli()
	c.lastErr = ""
	c.mu.Unlock()
	if old != nil {
		old.Close()
	}
	if onChange != nil {
		onChange()
	}

	err = runtimeConn.readLoop(ctx)
	runtimeConn.Close()

	c.mu.Lock()
	if c.conn == runtimeConn {
		c.conn = nil
		c.connectedAtUnixMS = 0
		if strings.TrimSpace(c.session.SessionID) != "" && c.session.ExpiresAtUnixMS > 0 && time.Now().UnixMilli() >= c.session.ExpiresAtUnixMS {
			c.lastErr = "Desktop model source session expired."
		} else if strings.TrimSpace(c.session.SessionID) != "" {
			c.lastErr = "Desktop model source disconnected."
			if err != nil && !errors.Is(err, context.Canceled) {
				c.lastErr = err.Error()
			}
		}
	}
	c.mu.Unlock()
	if onChange != nil {
		onChange()
	}
	if err != nil && !errors.Is(err, context.Canceled) && !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
		return err
	}
	return nil
}

func (c *desktopModelSourceClient) Disconnect() {
	if c == nil {
		return
	}
	var old *desktopModelSourceRuntimeConn
	c.mu.Lock()
	old = c.conn
	c.conn = nil
	c.session = DesktopModelSourceSession{}
	c.connectedAtUnixMS = 0
	c.lastErr = ""
	c.lastSnapshot = nil
	c.currentModelID = ""
	c.mu.Unlock()
	if old != nil {
		old.Close()
	}
}

func (c *desktopModelSourceClient) Status(ctx context.Context) *DesktopModelSourceStatus {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn != nil {
		statusCtx := ctx
		cancel := func() {}
		if statusCtx == nil {
			statusCtx = context.Background()
		}
		if _, ok := statusCtx.Deadline(); !ok {
			statusCtx, cancel = context.WithTimeout(statusCtx, 1500*time.Millisecond)
		}
		defer cancel()
		var status DesktopModelSourceStatus
		if err := conn.call(statusCtx, "ai.status.get", nil, nil, &status); err == nil {
			c.mu.Lock()
			c.lastErr = ""
			out := c.mergeStatusLocked(status, time.Now())
			c.mu.Unlock()
			return out
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.statusLocked(time.Now())
}

func (c *desktopModelSourceClient) BindingStatus(ctx context.Context) runtimeservice.Binding {
	if c == nil {
		return runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}
	if ctx != nil {
		_ = c.Status(ctx)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return runtimeservice.NormalizeBinding(c.bindingLocked(time.Now()), runtimeservice.Capability{
		Supported:  true,
		BindMethod: runtimeservice.RuntimeControlBindMethodV1,
	})
}

func (c *desktopModelSourceClient) SetCurrentModelID(modelID string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.currentModelID = strings.TrimSpace(modelID)
	c.mu.Unlock()
}

func (c *desktopModelSourceClient) CurrentModelID() string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.TrimSpace(c.currentModelID)
}

func (c *desktopModelSourceClient) ListModels(ctx context.Context) (*DesktopModelSourceModelSnapshot, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return nil, errors.New("desktop model source is not connected")
	}
	checkCtx := ctx
	cancel := func() {}
	if checkCtx == nil {
		checkCtx = context.Background()
	}
	if _, ok := checkCtx.Deadline(); !ok {
		checkCtx, cancel = context.WithTimeout(checkCtx, 3*time.Second)
	}
	defer cancel()
	var out DesktopModelSourceModelSnapshot
	if err := conn.call(checkCtx, "ai.models.list", nil, nil, &out); err != nil {
		c.mu.Lock()
		c.lastErr = strings.TrimSpace(err.Error())
		c.mu.Unlock()
		return nil, err
	}
	sort.Strings(out.MissingKeyProviderIDs)
	c.mu.Lock()
	c.lastErr = ""
	cp := out
	cp.Models = append([]DesktopModelSourceModel(nil), out.Models...)
	cp.MissingKeyProviderIDs = append([]string(nil), out.MissingKeyProviderIDs...)
	c.lastSnapshot = &cp
	c.mu.Unlock()
	return &out, nil
}

func (c *desktopModelSourceClient) ModelGateway(defaultModelID string) ModelGateway {
	if c == nil {
		return nil
	}
	return &desktopModelSourceProvider{
		client:         c,
		defaultModelID: strings.TrimSpace(defaultModelID),
	}
}

func (c *desktopModelSourceClient) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if c == nil {
		return ModelGatewayResult{}, ErrNotConfigured
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return ModelGatewayResult{}, errors.New("desktop model source is not connected")
	}
	var out ModelGatewayResult
	if err := conn.call(ctx, "ai.turn.stream", desktopModelSourceStreamRequest{Request: req}, onEvent, &out); err != nil {
		c.mu.Lock()
		c.lastErr = strings.TrimSpace(err.Error())
		c.mu.Unlock()
		return ModelGatewayResult{}, err
	}
	return out, nil
}

func (c *desktopModelSourceClient) statusLocked(now time.Time) *DesktopModelSourceStatus {
	return c.mergeStatusLocked(DesktopModelSourceStatus{}, now)
}

func (c *desktopModelSourceClient) mergeStatusLocked(remote DesktopModelSourceStatus, now time.Time) *DesktopModelSourceStatus {
	binding := c.bindingLocked(now)
	snapshot := c.lastSnapshot
	modelCount := remote.ModelCount
	if modelCount <= 0 && snapshot != nil {
		modelCount = len(snapshot.Models)
	}
	missing := append([]string(nil), remote.MissingKeyProviderIDs...)
	if len(missing) == 0 && snapshot != nil {
		missing = append([]string(nil), snapshot.MissingKeyProviderIDs...)
	}
	sort.Strings(missing)
	lastErr := strings.TrimSpace(remote.LastError)
	if lastErr == "" {
		lastErr = strings.TrimSpace(binding.LastError)
	}
	status := &DesktopModelSourceStatus{
		BindingState:          string(binding.State),
		Connected:             c.conn != nil && binding.State == runtimeservice.BindingStateBound,
		Available:             remote.Available || modelCount > 0,
		ModelSource:           firstNonEmpty(remote.ModelSource, binding.ModelSource, DesktopModelSourceDefaultSource),
		SessionID:             firstNonEmpty(remote.SessionID, binding.SessionID),
		ExpiresAtUnixMS:       firstNonEmptyInt64(remote.ExpiresAtUnixMS, binding.ExpiresAtUnixMS),
		ConnectedAtUnixMS:     firstNonEmptyInt64(remote.ConnectedAtUnixMS, binding.ConnectedAtUnixMS),
		ModelCount:            maxInt(modelCount, 0),
		MissingKeyProviderIDs: missing,
		LastError:             lastErr,
	}
	if !status.Connected && status.BindingState == string(runtimeservice.BindingStateBound) {
		status.BindingState = string(runtimeservice.BindingStateError)
	}
	return status
}

func (c *desktopModelSourceClient) bindingLocked(now time.Time) runtimeservice.Binding {
	if c == nil {
		return runtimeservice.Binding{State: runtimeservice.BindingStateUnsupported}
	}
	sessionID := strings.TrimSpace(c.session.SessionID)
	if sessionID == "" {
		return runtimeservice.Binding{State: runtimeservice.BindingStateUnbound}
	}
	state := runtimeservice.BindingStateConnecting
	lastErr := strings.TrimSpace(c.lastErr)
	if c.session.ExpiresAtUnixMS > 0 && now.UnixMilli() >= c.session.ExpiresAtUnixMS {
		state = runtimeservice.BindingStateExpired
		if lastErr == "" {
			lastErr = "Desktop model source session expired."
		}
	} else if c.conn != nil {
		state = runtimeservice.BindingStateBound
		lastErr = ""
	} else if lastErr != "" {
		state = runtimeservice.BindingStateError
	}
	modelCount := 0
	var missing []string
	if c.lastSnapshot != nil {
		modelCount = len(c.lastSnapshot.Models)
		missing = append([]string(nil), c.lastSnapshot.MissingKeyProviderIDs...)
	}
	return runtimeservice.Binding{
		State:                 state,
		SessionID:             sessionID,
		ExpiresAtUnixMS:       c.session.ExpiresAtUnixMS,
		ConnectedAtUnixMS:     c.connectedAtUnixMS,
		ModelSource:           firstNonEmpty(c.session.Source, DesktopModelSourceDefaultSource),
		ModelCount:            modelCount,
		MissingKeyProviderIDs: missing,
		LastError:             lastErr,
	}
}

func newDesktopModelSourceRuntimeConn(ws *websocket.Conn) *desktopModelSourceRuntimeConn {
	return &desktopModelSourceRuntimeConn{
		ws:      ws,
		pending: make(map[string]chan DesktopModelSourceRPCFrame),
	}
}

func (c *desktopModelSourceRuntimeConn) readLoop(ctx context.Context) error {
	if c == nil || c.ws == nil {
		return errors.New("desktop model source websocket is not connected")
	}
	for {
		select {
		case <-ctx.Done():
			c.closeWithError(ctx.Err())
			return ctx.Err()
		default:
		}
		var frame DesktopModelSourceRPCFrame
		if err := c.ws.ReadJSON(&frame); err != nil {
			c.closeWithError(err)
			return err
		}
		frame.ProtocolVersion = strings.TrimSpace(frame.ProtocolVersion)
		if frame.ProtocolVersion != "" && frame.ProtocolVersion != DesktopModelSourceProtocolVersion {
			continue
		}
		frame.Type = strings.TrimSpace(frame.Type)
		switch frame.Type {
		case "event", "result", "error":
			c.dispatch(frame)
		case "ping":
			_ = c.writeFrame(ctx, DesktopModelSourceRPCFrame{
				ProtocolVersion: DesktopModelSourceProtocolVersion,
				Type:            "pong",
				ID:              strings.TrimSpace(frame.ID),
			})
		}
	}
}

func (c *desktopModelSourceRuntimeConn) call(ctx context.Context, method string, params any, onEvent func(StreamEvent), out any) error {
	if c == nil {
		return errors.New("desktop model source websocket is not connected")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id, err := newDesktopModelSourceRPCID()
	if err != nil {
		return err
	}
	ch := make(chan DesktopModelSourceRPCFrame, 64)
	if err := c.addPending(id, ch); err != nil {
		return err
	}
	defer c.removePending(id)

	rawParams, err := marshalRawMessage(params)
	if err != nil {
		return err
	}
	if err := c.writeFrame(ctx, DesktopModelSourceRPCFrame{
		ProtocolVersion: DesktopModelSourceProtocolVersion,
		Type:            "request",
		ID:              id,
		Method:          strings.TrimSpace(method),
		Params:          rawParams,
	}); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			_ = c.writeFrame(context.Background(), DesktopModelSourceRPCFrame{
				ProtocolVersion: DesktopModelSourceProtocolVersion,
				Type:            "cancel",
				ID:              id,
				Method:          "ai.turn.cancel",
			})
			return ctx.Err()
		case frame, ok := <-ch:
			if !ok {
				return errors.New("desktop model source disconnected")
			}
			switch strings.TrimSpace(frame.Type) {
			case "event":
				if frame.Event != nil && onEvent != nil {
					onEvent(*frame.Event)
				}
			case "result":
				if out == nil {
					return nil
				}
				if len(frame.Result) == 0 {
					return nil
				}
				return json.Unmarshal(frame.Result, out)
			case "error":
				return frame.Error
			}
		}
	}
}

func (c *desktopModelSourceRuntimeConn) addPending(id string, ch chan DesktopModelSourceRPCFrame) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("desktop model source disconnected")
	}
	c.pending[id] = ch
	return nil
}

func (c *desktopModelSourceRuntimeConn) removePending(id string) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
}

func (c *desktopModelSourceRuntimeConn) dispatch(frame DesktopModelSourceRPCFrame) {
	id := strings.TrimSpace(frame.ID)
	if id == "" {
		return
	}
	c.mu.Lock()
	ch := c.pending[id]
	c.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- frame:
	default:
	}
}

func (c *desktopModelSourceRuntimeConn) writeFrame(ctx context.Context, frame DesktopModelSourceRPCFrame) error {
	if c == nil || c.ws == nil {
		return errors.New("desktop model source websocket is not connected")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	c.mu.Lock()
	closed := c.closed
	c.mu.Unlock()
	if closed {
		return errors.New("desktop model source disconnected")
	}
	frame.ProtocolVersion = DesktopModelSourceProtocolVersion
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	deadline := time.Now().Add(defaultDesktopModelSourceRPCTimeout)
	if d, ok := ctx.Deadline(); ok {
		deadline = d
	}
	_ = c.ws.SetWriteDeadline(deadline)
	return c.ws.WriteJSON(frame)
}

func (c *desktopModelSourceRuntimeConn) Close() {
	c.closeWithError(errors.New("desktop model source disconnected"))
}

func (c *desktopModelSourceRuntimeConn) closeWithError(err error) {
	if c == nil {
		return
	}
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.closeErr = err
	pending := c.pending
	c.pending = make(map[string]chan DesktopModelSourceRPCFrame)
	c.mu.Unlock()
	if c.ws != nil {
		_ = c.ws.Close()
	}
	for _, ch := range pending {
		close(ch)
	}
}

func (p *desktopModelSourceProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if p == nil || p.client == nil {
		return ModelGatewayResult{}, ErrNotConfigured
	}
	model := strings.TrimSpace(req.Model)
	if model == "" || !isDesktopModelSourceModelID(model) {
		model = strings.TrimSpace(p.defaultModelID)
	}
	if model == "" {
		return ModelGatewayResult{}, errors.New("missing desktop model source model")
	}
	req.Model = model
	return p.client.StreamTurn(ctx, req, onEvent)
}

func RunDesktopModelSourceConnector(ctx context.Context, opts DesktopModelSourceConnectorOptions) error {
	if ctx == nil {
		ctx = context.Background()
	}
	session, err := normalizeDesktopModelSourceSession(DesktopModelSourceSession{
		SessionID:       opts.SessionID,
		Source:          opts.Source,
		ProtocolVersion: DesktopModelSourceProtocolVersion,
		ExpiresAtUnixMS: opts.ExpiresAtUnixMS,
	})
	if err != nil {
		return err
	}
	runtimeControlURL := strings.TrimSpace(opts.RuntimeControlBaseURL)
	token := strings.TrimSpace(opts.RuntimeControlToken)
	desktopOwnerID := strings.TrimSpace(opts.DesktopOwnerID)
	if runtimeControlURL == "" {
		return errors.New("missing runtime-control url")
	}
	if token == "" {
		return errors.New("missing runtime-control token")
	}
	if desktopOwnerID == "" {
		return errors.New("missing Desktop owner id")
	}
	executor := &desktopModelSourceExecutor{
		log:         opts.Logger,
		configPath:  strings.TrimSpace(opts.ConfigPath),
		secretsPath: strings.TrimSpace(opts.SecretsPath),
		session:     session,
	}
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	wsURL, err := desktopModelSourceRuntimeControlURL(runtimeControlURL, "v1/desktop-model-source/rpc")
	if err != nil {
		return err
	}
	switch wsURL.Scheme {
	case "http":
		wsURL.Scheme = "ws"
	case "https":
		wsURL.Scheme = "wss"
	default:
		return errors.New("runtime-control endpoint must use HTTP or HTTPS")
	}
	q := wsURL.Query()
	q.Set("session_id", session.SessionID)
	wsURL.RawQuery = q.Encode()
	header := http.Header{}
	header.Set("Authorization", "Bearer "+token)
	header.Set("X-Redeven-Desktop-Owner-ID", desktopOwnerID)
	header.Set("X-Redeven-Desktop-Model-Source-Protocol", DesktopModelSourceProtocolVersion)
	reported := false
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if session.ExpiresAtUnixMS > 0 && time.Now().UnixMilli() >= session.ExpiresAtUnixMS {
			return errors.New("desktop model source session expired")
		}
		if err := postDesktopModelSourceConnect(ctx, httpClient, runtimeControlURL, token, desktopOwnerID, session); err != nil {
			return err
		}
		ws, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL.String(), header)
		if err != nil {
			return err
		}
		if !reported {
			if err := executor.writeStartupReport(opts.StartupReportFile); err != nil {
				_ = ws.Close()
				return err
			}
			reported = true
		}
		err = executor.serve(ctx, ws)
		_ = ws.Close()
		if err == nil || errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return err
		}
		if opts.Logger != nil {
			opts.Logger.Warn("desktop model source disconnected; reconnecting", "error", err)
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

type desktopModelSourceExecutor struct {
	log         *slog.Logger
	configPath  string
	secretsPath string
	session     DesktopModelSourceSession
}

func (e *desktopModelSourceExecutor) serve(ctx context.Context, ws *websocket.Conn) error {
	if e == nil {
		return errors.New("missing desktop model source executor")
	}
	if ws == nil {
		return errors.New("missing desktop model source websocket")
	}
	var writeMu sync.Mutex
	var activeMu sync.Mutex
	active := map[string]context.CancelFunc{}

	cancelAll := func() {
		activeMu.Lock()
		defer activeMu.Unlock()
		for id, cancel := range active {
			cancel()
			delete(active, id)
		}
	}
	defer cancelAll()

	write := func(frame DesktopModelSourceRPCFrame) error {
		frame.ProtocolVersion = DesktopModelSourceProtocolVersion
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(defaultDesktopModelSourceRPCTimeout))
		return ws.WriteJSON(frame)
	}

	for {
		select {
		case <-ctx.Done():
			_ = ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
			return ctx.Err()
		default:
		}
		var frame DesktopModelSourceRPCFrame
		if err := ws.ReadJSON(&frame); err != nil {
			return err
		}
		frame.ProtocolVersion = strings.TrimSpace(frame.ProtocolVersion)
		if frame.ProtocolVersion != "" && frame.ProtocolVersion != DesktopModelSourceProtocolVersion {
			continue
		}
		frame.ID = strings.TrimSpace(frame.ID)
		frame.Type = strings.TrimSpace(frame.Type)
		frame.Method = strings.TrimSpace(frame.Method)
		switch frame.Type {
		case "request":
			if frame.ID == "" {
				continue
			}
			reqCtx, cancel := context.WithCancel(ctx)
			activeMu.Lock()
			active[frame.ID] = cancel
			activeMu.Unlock()
			go func(frame DesktopModelSourceRPCFrame) {
				defer func() {
					activeMu.Lock()
					delete(active, frame.ID)
					activeMu.Unlock()
					cancel()
				}()
				e.handleRequest(reqCtx, frame, write)
			}(frame)
		case "cancel":
			activeMu.Lock()
			cancel := active[frame.ID]
			activeMu.Unlock()
			if cancel != nil {
				cancel()
			}
		case "ping":
			_ = write(DesktopModelSourceRPCFrame{Type: "pong", ID: frame.ID})
		}
	}
}

func (e *desktopModelSourceExecutor) handleRequest(ctx context.Context, frame DesktopModelSourceRPCFrame, write func(DesktopModelSourceRPCFrame) error) {
	sendErr := func(code string, err error) {
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		if msg == "" {
			msg = "Desktop model source request failed."
		}
		_ = write(DesktopModelSourceRPCFrame{
			Type:  "error",
			ID:    frame.ID,
			Error: &DesktopModelSourceRPCError{Code: code, Message: msg},
		})
	}
	sendResult := func(v any) {
		raw, err := json.Marshal(v)
		if err != nil {
			sendErr("RESULT_ENCODE_FAILED", err)
			return
		}
		_ = write(DesktopModelSourceRPCFrame{Type: "result", ID: frame.ID, Result: raw})
	}
	switch frame.Method {
	case "ai.status.get":
		status, err := e.status()
		if err != nil {
			sendErr("STATUS_FAILED", err)
			return
		}
		sendResult(status)
	case "ai.models.list":
		snapshot, _, _, _, err := e.snapshot()
		if err != nil {
			sendErr("MODELS_FAILED", err)
			return
		}
		sendResult(snapshot)
	case "ai.turn.stream":
		result, err := e.streamTurn(ctx, frame, write)
		if err != nil {
			sendErr("TURN_STREAM_FAILED", err)
			return
		}
		sendResult(result)
	default:
		sendErr("METHOD_NOT_FOUND", fmt.Errorf("unknown desktop model source method %q", frame.Method))
	}
}

func (e *desktopModelSourceExecutor) status() (*DesktopModelSourceStatus, error) {
	snapshot, _, _, _, err := e.snapshot()
	if err != nil {
		return nil, err
	}
	return &DesktopModelSourceStatus{
		BindingState:          string(runtimeservice.BindingStateBound),
		Connected:             true,
		Available:             snapshot != nil && len(snapshot.Models) > 0,
		ModelSource:           firstNonEmpty(e.session.Source, DesktopModelSourceDefaultSource),
		SessionID:             e.session.SessionID,
		ExpiresAtUnixMS:       e.session.ExpiresAtUnixMS,
		ConnectedAtUnixMS:     time.Now().UnixMilli(),
		ModelCount:            len(snapshot.Models),
		MissingKeyProviderIDs: append([]string(nil), snapshot.MissingKeyProviderIDs...),
	}, nil
}

func (e *desktopModelSourceExecutor) streamTurn(ctx context.Context, frame DesktopModelSourceRPCFrame, write func(DesktopModelSourceRPCFrame) error) (ModelGatewayResult, error) {
	var body desktopModelSourceStreamRequest
	if len(frame.Params) > 0 {
		if err := json.Unmarshal(frame.Params, &body); err != nil {
			return ModelGatewayResult{}, err
		}
	}
	snapshot, cfg, secretStore, registry, err := e.snapshot()
	if err != nil {
		return ModelGatewayResult{}, err
	}
	publicModelID := strings.TrimSpace(body.Request.Model)
	if publicModelID == "" {
		publicModelID = strings.TrimSpace(snapshot.CurrentModel)
	}
	entry, ok := registry[publicModelID]
	if !ok || cfg == nil || cfg.AI == nil {
		return ModelGatewayResult{}, fmt.Errorf("model not allowed: %s", publicModelID)
	}
	if !desktopModelSourceSnapshotHasModel(snapshot, publicModelID) {
		return ModelGatewayResult{}, errors.New("desktop model is missing its local API key")
	}
	apiKey, ok, err := secretStore.GetAIProviderAPIKey(entry.ProviderID)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	if !ok || strings.TrimSpace(apiKey) == "" {
		return ModelGatewayResult{}, errors.New("desktop provider is missing its local API key")
	}
	adapter, err := newProviderAdapter(strings.TrimSpace(entry.ProviderCfg.Type), strings.TrimSpace(entry.ProviderCfg.BaseURL), strings.TrimSpace(apiKey), entry.ProviderCfg.StrictToolSchema, parallelToolCallsWireOmit)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	req := body.Request
	req.Model = strings.TrimSpace(entry.ModelName)
	return adapter.StreamTurn(ctx, req, func(ev StreamEvent) {
		_ = write(DesktopModelSourceRPCFrame{
			Type:  "event",
			ID:    frame.ID,
			Event: &ev,
		})
	})
}

func (e *desktopModelSourceExecutor) snapshot() (*DesktopModelSourceModelSnapshot, *config.Config, *settings.SecretsStore, map[string]desktopModelSourceRegistryEntry, error) {
	cfgPath := strings.TrimSpace(e.configPath)
	if cfgPath == "" {
		return nil, nil, nil, nil, errors.New("missing config path")
	}
	secretStore := settings.NewSecretsStore(e.secretsPath)
	cfg, err := config.Load(cfgPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &DesktopModelSourceModelSnapshot{Configured: false}, nil, secretStore, map[string]desktopModelSourceRegistryEntry{}, nil
		}
		return nil, nil, nil, nil, err
	}
	snapshot, registry, err := buildDesktopModelSourceModelSnapshot(cfg.AI, secretStore)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	return snapshot, cfg, secretStore, registry, nil
}

func (e *desktopModelSourceExecutor) writeStartupReport(reportFile string) error {
	reportFile = strings.TrimSpace(reportFile)
	if reportFile == "" {
		return nil
	}
	snapshot, _, _, _, err := e.snapshot()
	if err != nil {
		snapshot = &DesktopModelSourceModelSnapshot{}
	}
	report := DesktopModelSourceStartupReport{
		Status:                "connected",
		SessionID:             e.session.SessionID,
		PID:                   os.Getpid(),
		Configured:            snapshot != nil && snapshot.Configured,
		ModelCount:            len(snapshot.Models),
		MissingKeyProviderIDs: append([]string(nil), snapshot.MissingKeyProviderIDs...),
	}
	if err := os.MkdirAll(filepath.Dir(reportFile), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(reportFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewEncoder(f).Encode(report)
}

func buildDesktopModelSourceModelSnapshot(cfg *config.AIConfig, secretStore *settings.SecretsStore) (*DesktopModelSourceModelSnapshot, map[string]desktopModelSourceRegistryEntry, error) {
	out := &DesktopModelSourceModelSnapshot{Configured: cfg != nil}
	registry := map[string]desktopModelSourceRegistryEntry{}
	if cfg == nil {
		return out, registry, nil
	}
	providerNameByID := map[string]string{}
	for _, p := range cfg.Providers {
		id := strings.TrimSpace(p.ID)
		if id == "" {
			continue
		}
		name := strings.TrimSpace(p.Name)
		if name == "" {
			name = defaultProviderDisplayName(p)
		}
		if name == "" {
			name = id
		}
		providerNameByID[id] = name
	}
	missing := map[string]struct{}{}
	seen := map[string]struct{}{}
	currentLocal := strings.TrimSpace(cfg.CurrentModelID)
	capabilityResolver := contextadapter.NewResolver(nil)
	for _, p := range cfg.Providers {
		providerID := strings.TrimSpace(p.ID)
		if providerID == "" {
			continue
		}
		keySet := false
		if secretStore != nil {
			var err error
			keySet, err = secretStore.HasAIProviderAPIKey(providerID)
			if err != nil {
				return nil, nil, err
			}
		}
		if !keySet {
			missing[providerID] = struct{}{}
			continue
		}
		providerName := firstNonEmpty(providerNameByID[providerID], providerID)
		for _, m := range p.Models {
			modelName := strings.TrimSpace(m.ModelName)
			if modelName == "" {
				continue
			}
			localID := providerID + "/" + modelName
			if _, ok := seen[localID]; ok {
				continue
			}
			seen[localID] = struct{}{}
			publicID := desktopModelSourcePublicModelID(p, m)
			capability, err := capabilityResolver.Resolve(context.Background(), p, localID)
			if err != nil {
				return nil, nil, err
			}
			capability = sanitizeDesktopModelSourceCapability(publicID, capability)
			model := DesktopModelSourceModel{
				ID:                            publicID,
				Label:                         providerName + " / " + modelName,
				Provider:                      providerName,
				ContextWindow:                 m.ContextWindow,
				MaxOutputTokens:               m.MaxOutputTokens,
				EffectiveContextWindowPercent: m.EffectiveContextWindowPercent,
				InputModalities:               m.NormalizedInputModalities(),
				SupportsImageInput:            m.SupportsImageInput(),
				ReasoningCapability:           m.EffectiveReasoningCapability(strings.TrimSpace(p.Type)),
				Capability:                    &capability,
			}
			out.Models = append(out.Models, model)
			registry[publicID] = desktopModelSourceRegistryEntry{
				Model:       model,
				ProviderID:  providerID,
				ModelName:   modelName,
				ProviderCfg: p,
			}
			if currentLocal != "" && currentLocal == localID {
				out.CurrentModel = publicID
			}
		}
	}
	for id := range missing {
		out.MissingKeyProviderIDs = append(out.MissingKeyProviderIDs, id)
	}
	sort.Strings(out.MissingKeyProviderIDs)
	return out, registry, nil
}

func sanitizeDesktopModelSourceCapability(modelID string, capability contextmodel.ModelCapability) contextmodel.ModelCapability {
	modelID = strings.TrimSpace(modelID)
	capability = contextmodel.NormalizeCapability(capability)
	capability.ProviderID = DesktopModelSourceProviderType
	capability.ProviderType = DesktopModelSourceProviderType
	capability.ModelName = modelID
	capability.WireModelName = modelID
	return contextmodel.NormalizeCapability(capability)
}

func desktopModelSourceModelCapability(model DesktopModelSourceModel) contextmodel.ModelCapability {
	modelID := strings.TrimSpace(model.ID)
	if model.Capability != nil {
		return sanitizeDesktopModelSourceCapability(modelID, *model.Capability)
	}

	capability := defaultModelCapability(DesktopModelSourceProviderType, modelID, modelID)
	legacyModel := config.AIProviderModel{
		ContextWindow:                 model.ContextWindow,
		MaxOutputTokens:               model.MaxOutputTokens,
		EffectiveContextWindowPercent: model.EffectiveContextWindowPercent,
		InputModalities:               append([]string(nil), model.InputModalities...),
		ReasoningCapability:           model.ReasoningCapability,
	}
	if contextWindow := legacyModel.EffectiveInputWindowTokens(); contextWindow > 0 {
		capability.MaxContextTokens = contextWindow
	}
	if model.MaxOutputTokens > 0 {
		capability.MaxOutputTokens = model.MaxOutputTokens
	}
	capability.SupportsImageInput = model.SupportsImageInput || legacyModel.SupportsImageInput()
	capability.ReasoningCapability = model.ReasoningCapability.Normalize()
	return sanitizeDesktopModelSourceCapability(modelID, capability)
}

func desktopModelSourcePublicModelID(p config.AIProvider, m config.AIProviderModel) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(p.ID),
		strings.TrimSpace(p.Type),
		strings.TrimSpace(p.BaseURL),
		strings.TrimSpace(m.ModelName),
	}, "\x00")))
	return desktopModelSourceModelIDPrefix + hex.EncodeToString(sum[:])
}

func desktopModelSourceSnapshotHasModel(snapshot *DesktopModelSourceModelSnapshot, modelID string) bool {
	_, ok := desktopModelSourceSnapshotModel(snapshot, modelID)
	return ok
}

func desktopModelSourceSnapshotModel(snapshot *DesktopModelSourceModelSnapshot, modelID string) (DesktopModelSourceModel, bool) {
	if snapshot == nil {
		return DesktopModelSourceModel{}, false
	}
	modelID = strings.TrimSpace(modelID)
	for _, model := range snapshot.Models {
		if strings.TrimSpace(model.ID) == modelID {
			return model, true
		}
	}
	return DesktopModelSourceModel{}, false
}

func isDesktopModelSourceModelID(modelID string) bool {
	modelID = strings.TrimSpace(modelID)
	return strings.HasPrefix(modelID, desktopModelSourceModelIDPrefix) && len(modelID) > len(desktopModelSourceModelIDPrefix)
}

func defaultProviderDisplayName(p config.AIProvider) string {
	switch strings.ToLower(strings.TrimSpace(p.Type)) {
	case "openai":
		return "OpenAI"
	case "anthropic":
		return "Anthropic"
	case "chatglm":
		return "ChatGLM"
	case "deepseek":
		return "DeepSeek"
	case "qwen":
		return "Qwen"
	case "moonshot":
		return "Moonshot"
	case "openai_compatible":
		baseURL := strings.TrimSpace(p.BaseURL)
		if baseURL != "" {
			if u, err := url.Parse(baseURL); err == nil && u != nil {
				if host := strings.TrimSpace(u.Host); host != "" {
					return host
				}
			}
		}
		return "OpenAI compatible"
	default:
		return ""
	}
}

func postDesktopModelSourceConnect(ctx context.Context, client *http.Client, baseURL string, token string, desktopOwnerID string, session DesktopModelSourceSession) error {
	u, err := desktopModelSourceRuntimeControlURL(baseURL, "v1/desktop-model-source/connect")
	if err != nil {
		return err
	}
	body := map[string]any{
		"session_id":         session.SessionID,
		"source":             firstNonEmpty(session.Source, DesktopModelSourceDefaultSource),
		"protocol_version":   DesktopModelSourceProtocolVersion,
		"expires_at_unix_ms": session.ExpiresAtUnixMS,
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Redeven-Desktop-Owner-ID", desktopOwnerID)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var envelope struct {
		OK    bool                        `json:"ok"`
		Error *DesktopModelSourceRPCError `json:"error,omitempty"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&envelope)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !envelope.OK {
		if envelope.Error != nil {
			return envelope.Error
		}
		return fmt.Errorf("runtime-control returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func desktopModelSourceRuntimeControlURL(baseURL string, route string) (*url.URL, error) {
	root, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, err
	}
	if root == nil || strings.TrimSpace(root.Scheme) == "" || strings.TrimSpace(root.Host) == "" {
		return nil, errors.New("runtime-control endpoint URL is invalid")
	}
	if root.Scheme != "http" && root.Scheme != "https" {
		return nil, errors.New("runtime-control endpoint must use HTTP or HTTPS")
	}
	if !strings.HasSuffix(root.Path, "/") {
		root.Path += "/"
	}
	rel, err := url.Parse(strings.TrimLeft(strings.TrimSpace(route), "/"))
	if err != nil {
		return nil, err
	}
	return root.ResolveReference(rel), nil
}

func marshalRawMessage(v any) (json.RawMessage, error) {
	if v == nil {
		return nil, nil
	}
	if raw, ok := v.(json.RawMessage); ok {
		return raw, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(b), nil
}

func newDesktopModelSourceRPCID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "dms_rpc_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func firstNonEmptyInt64(values ...int64) int64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func (s *Service) PrepareDesktopModelSource(session DesktopModelSourceSession) (*AIRuntimeStatus, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	if modelSource == nil {
		modelSource = newDesktopModelSourceClient(s.log)
		s.desktopModelSource = modelSource
	}
	coordinator := s.threadTitleCoordinator
	s.mu.Unlock()
	if _, err := modelSource.Prepare(session); err != nil {
		return nil, err
	}
	if coordinator != nil {
		coordinator.Wake()
	}
	return s.RuntimeStatus(context.Background()), nil
}

func (s *Service) ServeDesktopModelSourceRPC(ctx context.Context, session DesktopModelSourceSession, ws *websocket.Conn, onChange func()) error {
	if s == nil {
		if ws != nil {
			_ = ws.Close()
		}
		return errors.New("nil service")
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	if modelSource == nil {
		modelSource = newDesktopModelSourceClient(s.log)
		s.desktopModelSource = modelSource
	}
	coordinator := s.threadTitleCoordinator
	s.mu.Unlock()
	wrappedOnChange := func() {
		if coordinator != nil {
			coordinator.Wake()
		}
		if onChange != nil {
			onChange()
		}
	}
	return modelSource.ServeRPC(ctx, session, ws, wrappedOnChange)
}

func (s *Service) DisconnectDesktopModelSource() *AIRuntimeStatus {
	if s == nil {
		return &AIRuntimeStatus{}
	}
	s.mu.Lock()
	modelSource := s.desktopModelSource
	coordinator := s.threadTitleCoordinator
	s.mu.Unlock()
	if modelSource != nil {
		modelSource.Disconnect()
	}
	if coordinator != nil {
		coordinator.Wake()
	}
	return s.RuntimeStatus(context.Background())
}
