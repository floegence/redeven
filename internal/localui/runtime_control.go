package localui

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/gorilla/websocket"
)

const runtimeControlProtocolVersion = "redeven-runtime-control-v2"

type runtimeControlServer struct {
	log         logger
	agent       *agent.Agent
	appServer   *appserver.Server
	afterChange func()
	token       string
	ln          net.Listener
	srv         *http.Server
}

type logger interface {
	Warn(msg string, args ...any)
	Info(msg string, args ...any)
}

func newRuntimeControlServer(a *agent.Agent, appServer *appserver.Server, log logger, afterChange func()) (*runtimeControlServer, error) {
	if a == nil {
		return nil, errors.New("missing Agent")
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, err
	}
	token := "rtctl_" + base64.RawURLEncoding.EncodeToString(tokenBytes)
	return &runtimeControlServer{
		log:         log,
		agent:       a,
		appServer:   appServer,
		afterChange: afterChange,
		token:       token,
	}, nil
}

func (s *runtimeControlServer) appServerHandler() *appserver.Server {
	if s == nil {
		return nil
	}
	return s.appServer
}

func (s *runtimeControlServer) Start(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if s.srv != nil {
		return nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    localUIMaxHeaderBytes,
	}
	s.ln = ln
	s.srv = srv
	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) && s.log != nil {
			s.log.Warn("runtime-control server stopped", "error", err)
		}
	}()
	if s.log != nil {
		s.log.Info("runtime-control listening", "addr", ln.Addr().String())
	}
	return nil
}

func (s *runtimeControlServer) StartOnListener(ctx context.Context, ln net.Listener) error {
	if s == nil {
		return nil
	}
	if s.srv != nil {
		return nil
	}
	if ln == nil {
		return errors.New("missing runtime-control listener")
	}
	srv := &http.Server{
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    localUIMaxHeaderBytes,
	}
	s.ln = ln
	s.srv = srv
	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) && s.log != nil {
			s.log.Warn("runtime-control server stopped", "error", err)
		}
	}()
	if s.log != nil {
		s.log.Info("runtime-control listening", "addr", ln.Addr().String())
	}
	return nil
}

func (s *runtimeControlServer) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/provider-link", s.handleProviderLink)
	mux.HandleFunc("/v2/provider-link/connect", s.handleProviderLinkConnect)
	mux.HandleFunc("/v2/provider-link/disconnect", s.handleProviderLinkDisconnect)
	mux.HandleFunc("/v2/code-workspace-engine/status", s.handleCodeWorkspaceEngineStatus)
	mux.HandleFunc("/v2/desktop-model-source", s.handleDesktopModelSource)
	mux.HandleFunc("/v2/desktop-model-source/connect", s.handleDesktopModelSourceConnect)
	mux.HandleFunc("/v2/desktop-model-source/disconnect", s.handleDesktopModelSourceDisconnect)
	mux.HandleFunc("/v2/desktop-model-source/rpc", s.handleDesktopModelSourceRPC)
	mux.HandleFunc("GET /v2/runtime/identity", s.handleRuntimeIdentity)
	mux.HandleFunc("GET /v2/runtime/workload-snapshot", s.handleRuntimeWorkloadSnapshot)
	mux.HandleFunc("POST /v2/runtime/lifecycle-fence/begin", s.handleRuntimeLifecycleFenceBegin)
	mux.HandleFunc("POST /v2/runtime/lifecycle-fence/release", s.handleRuntimeLifecycleFenceRelease)
	mux.HandleFunc("POST /v2/runtime/shutdown", s.handleRuntimeShutdown)
	mux.HandleFunc("GET /v2/runtime/health", s.handleRuntimeHealth)
	return withLocalUISecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r == nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if _, err := canonicalLoopbackAuthority(r.Host); err != nil {
			writeRuntimeControlError(w, http.StatusMisdirectedRequest, "RUNTIME_CONTROL_INVALID_AUTHORITY", "Runtime control requires a loopback authority.")
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		}
		mux.ServeHTTP(w, r)
	}))
}

func (s *runtimeControlServer) Close() error {
	if s == nil {
		return nil
	}
	if s.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.srv.Shutdown(ctx)
	}
	if s.ln != nil {
		_ = s.ln.Close()
	}
	s.srv = nil
	s.ln = nil
	return nil
}

func (s *runtimeControlServer) Endpoint() *runtimemanagement.RuntimeControlEndpoint {
	if s == nil || s.ln == nil {
		return nil
	}
	addr, ok := s.ln.Addr().(*net.TCPAddr)
	if !ok || addr.Port <= 0 {
		return nil
	}
	return &runtimemanagement.RuntimeControlEndpoint{
		ProtocolVersion: runtimeControlProtocolVersion,
		BaseURL:         fmt.Sprintf("http://127.0.0.1:%d", addr.Port),
		Token:           s.token,
	}
}

type runtimeControlEnvelope struct {
	OK    bool                 `json:"ok"`
	Data  any                  `json:"data,omitempty"`
	Error *runtimeControlError `json:"error,omitempty"`
}

type runtimeControlError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (s *runtimeControlServer) require(w http.ResponseWriter, r *http.Request) bool {
	if s == nil || w == nil || r == nil {
		return false
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		writeRuntimeControlError(w, http.StatusForbidden, "RUNTIME_CONTROL_FORBIDDEN", "Runtime control only accepts loopback requests.")
		return false
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth != "Bearer "+s.token {
		writeRuntimeControlError(w, http.StatusUnauthorized, "RUNTIME_CONTROL_UNAUTHORIZED", "Runtime control token is invalid.")
		return false
	}
	return true
}

type runtimeLifecycleFenceBeginRequest struct {
	ProtocolVersion  string `json:"protocol_version"`
	OperationID      string `json:"operation_id"`
	TargetGeneration int64  `json:"target_generation"`
}

type runtimeLifecycleFenceTokenRequest struct {
	ProtocolVersion string `json:"protocol_version"`
	FenceToken      string `json:"fence_token"`
}

func (s *runtimeControlServer) handleRuntimeIdentity(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	identity, err := s.agent.RuntimeLifecycleIdentity()
	if err != nil {
		writeRuntimeControlError(w, http.StatusServiceUnavailable, "RUNTIME_IDENTITY_UNAVAILABLE", err.Error())
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: identity})
}

func (s *runtimeControlServer) handleRuntimeWorkloadSnapshot(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: s.agent.RuntimeLifecycleSnapshot()})
}

func (s *runtimeControlServer) handleRuntimeLifecycleFenceBegin(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	var request runtimeLifecycleFenceBeginRequest
	if !decodeRuntimeControlJSON(w, r, &request) {
		return
	}
	if request.ProtocolVersion != runtimeControlProtocolVersion {
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_CONTROL_PROTOCOL_INCOMPATIBLE", "Runtime control protocol is not supported.")
		return
	}
	fence, err := s.agent.BeginRuntimeLifecycleFence(request.OperationID, request.TargetGeneration)
	if err != nil {
		writeRuntimeLifecycleManagerError(w, err)
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: fence})
}

func (s *runtimeControlServer) handleRuntimeLifecycleFenceRelease(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	var request runtimeLifecycleFenceTokenRequest
	if !decodeRuntimeControlJSON(w, r, &request) {
		return
	}
	if request.ProtocolVersion != runtimeControlProtocolVersion {
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_CONTROL_PROTOCOL_INCOMPATIBLE", "Runtime control protocol is not supported.")
		return
	}
	if err := s.agent.ReleaseRuntimeLifecycleFence(request.FenceToken); err != nil {
		writeRuntimeLifecycleManagerError(w, err)
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: map[string]any{"released": true}})
}

func (s *runtimeControlServer) handleRuntimeShutdown(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	var request runtimeLifecycleFenceTokenRequest
	if !decodeRuntimeControlJSON(w, r, &request) {
		return
	}
	if request.ProtocolVersion != runtimeControlProtocolVersion {
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_CONTROL_PROTOCOL_INCOMPATIBLE", "Runtime control protocol is not supported.")
		return
	}
	if err := s.agent.RequestRuntimeLifecycleShutdown(request.FenceToken); err != nil {
		writeRuntimeLifecycleManagerError(w, err)
		return
	}
	writeRuntimeControlJSON(w, http.StatusAccepted, runtimeControlEnvelope{OK: true, Data: map[string]any{"shutdown_requested": true}})
}

func (s *runtimeControlServer) handleRuntimeHealth(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: map[string]any{
		"status": "ok", "service_protocol": runtimeservice.ProtocolVersion,
		"compatibility_epoch": runtimeservice.CurrentCompatibilityContract().CompatibilityEpoch,
	}})
}

func decodeRuntimeControlJSON(w http.ResponseWriter, r *http.Request, output any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_CONTROL_INVALID_REQUEST", "Runtime control request JSON is invalid.")
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_CONTROL_INVALID_REQUEST", "Runtime control request JSON is invalid.")
		return false
	}
	return true
}

func writeRuntimeLifecycleManagerError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, runtimeservice.ErrLifecycleAdmissionClosed), errors.Is(err, runtimeservice.ErrLifecycleFenceHeld):
		writeRuntimeControlError(w, http.StatusConflict, "OPERATION_IN_PROGRESS", err.Error())
	case errors.Is(err, runtimeservice.ErrLifecycleFenceToken):
		writeRuntimeControlError(w, http.StatusForbidden, "STALE_FENCE_TOKEN", err.Error())
	default:
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_LIFECYCLE_INVALID_REQUEST", err.Error())
	}
}

func (s *runtimeControlServer) handleProviderLink(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{
		OK: true,
		Data: map[string]any{
			"binding":         s.agent.ProviderLinkBinding(),
			"runtime_service": s.agent.RuntimeServiceSnapshot(),
		},
	})
}

type runtimeControlProviderLinkRequest struct {
	ProviderOrigin         string `json:"provider_origin"`
	ProviderID             string `json:"provider_id"`
	EnvPublicID            string `json:"env_public_id"`
	AccessPointOrigin      string `json:"access_point_origin"`
	RuntimeLinkTicket      string `json:"runtime_link_ticket"`
	AllowRelinkWhenIdle    bool   `json:"allow_relink_when_idle"`
	ExpectedCurrentBinding *struct {
		ProviderOrigin    string `json:"provider_origin"`
		ProviderID        string `json:"provider_id"`
		EnvPublicID       string `json:"env_public_id"`
		AccessPointOrigin string `json:"access_point_origin"`
		BindingGeneration int64  `json:"binding_generation"`
	} `json:"expected_current_binding,omitempty"`
}

func (s *runtimeControlServer) handleProviderLinkConnect(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	var body runtimeControlProviderLinkRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeRuntimeControlError(w, http.StatusBadRequest, "PROVIDER_LINK_INVALID_REQUEST", "Invalid provider-link request JSON.")
		return
	}
	req := agent.ProviderLinkRequest{
		ProviderOrigin:      body.ProviderOrigin,
		ProviderID:          body.ProviderID,
		EnvPublicID:         body.EnvPublicID,
		AccessPointOrigin:   body.AccessPointOrigin,
		RuntimeLinkTicket:   body.RuntimeLinkTicket,
		AllowRelinkWhenIdle: body.AllowRelinkWhenIdle,
	}
	if body.ExpectedCurrentBinding != nil {
		req.ExpectedProviderOrigin = body.ExpectedCurrentBinding.ProviderOrigin
		req.ExpectedProviderID = body.ExpectedCurrentBinding.ProviderID
		req.ExpectedEnvPublicID = body.ExpectedCurrentBinding.EnvPublicID
		req.ExpectedAccessPointOrigin = body.ExpectedCurrentBinding.AccessPointOrigin
		req.ExpectedGeneration = body.ExpectedCurrentBinding.BindingGeneration
	}
	resp, err := s.agent.ConnectProvider(r.Context(), req)
	if err != nil {
		writeRuntimeControlAgentError(w, err)
		return
	}
	s.notifyProviderLinkChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{
		OK: true,
		Data: map[string]any{
			"linked":          true,
			"binding":         resp.Binding,
			"runtime_service": s.agent.RuntimeServiceSnapshot(),
		},
	})
}

func (s *runtimeControlServer) handleProviderLinkDisconnect(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	resp, err := s.agent.DisconnectProvider(r.Context())
	if err != nil {
		writeRuntimeControlAgentError(w, err)
		return
	}
	s.notifyProviderLinkChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{
		OK: true,
		Data: map[string]any{
			"linked":          false,
			"binding":         resp.Binding,
			"runtime_service": s.agent.RuntimeServiceSnapshot(),
		},
	})
}

func (s *runtimeControlServer) handleCodeWorkspaceEngineStatus(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	appSrv := s.appServerHandler()
	if appSrv == nil {
		writeRuntimeControlError(w, http.StatusServiceUnavailable, "CODE_WORKSPACE_ENGINE_UNAVAILABLE", "Code workspace engine is not available.")
		return
	}
	status, err := appSrv.CodeRuntimeStatus(r.Context())
	if err != nil {
		writeRuntimeControlError(w, http.StatusServiceUnavailable, "CODE_WORKSPACE_ENGINE_STATUS_FAILED", err.Error())
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: status})
}

type runtimeControlDesktopModelSourceRequest struct {
	SessionID       string `json:"session_id"`
	Source          string `json:"source"`
	ProtocolVersion string `json:"protocol_version"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms,omitempty"`
}

func (s *runtimeControlServer) handleDesktopModelSource(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{
		OK: true,
		Data: map[string]any{
			"binding":         s.agent.RuntimeServiceSnapshot().Bindings.DesktopModelSource,
			"runtime_service": s.agent.RuntimeServiceSnapshot(),
		},
	})
}

func (s *runtimeControlServer) handleDesktopModelSourceConnect(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	var body runtimeControlDesktopModelSourceRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeRuntimeControlError(w, http.StatusBadRequest, "DESKTOP_MODEL_SOURCE_INVALID_REQUEST", "Invalid desktop model source request JSON.")
		return
	}
	status, err := s.agent.PrepareDesktopModelSource(ai.DesktopModelSourceSession{
		SessionID:       body.SessionID,
		Source:          body.Source,
		ProtocolVersion: body.ProtocolVersion,
		ExpiresAtUnixMS: body.ExpiresAtUnixMS,
	})
	if err != nil {
		writeRuntimeControlError(w, http.StatusBadRequest, "DESKTOP_MODEL_SOURCE_CONNECT_FAILED", err.Error())
		return
	}
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{
		OK: true,
		Data: map[string]any{
			"connected":       false,
			"ai_runtime":      status,
			"runtime_service": s.agent.RuntimeServiceSnapshot(),
		},
	})
}

func (s *runtimeControlServer) handleDesktopModelSourceDisconnect(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	status := s.agent.DisconnectDesktopModelSource()
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{
		OK: true,
		Data: map[string]any{
			"connected":       false,
			"ai_runtime":      status,
			"runtime_service": s.agent.RuntimeServiceSnapshot(),
		},
	})
}

func (s *runtimeControlServer) handleDesktopModelSourceRPC(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	if sessionID == "" {
		writeRuntimeControlError(w, http.StatusBadRequest, "DESKTOP_MODEL_SOURCE_INVALID_REQUEST", "Missing desktop model source session id.")
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(req *http.Request) bool {
		return strictSameOriginWSRequest(req, false)
	}}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	_ = conn.SetWriteDeadline(time.Time{})
	conn.SetReadLimit(localUIWSReadLimit)
	session := ai.DesktopModelSourceSession{
		SessionID:       sessionID,
		Source:          ai.DesktopModelSourceDefaultSource,
		ProtocolVersion: strings.TrimSpace(r.Header.Get("X-Redeven-Desktop-Model-Source-Protocol")),
	}
	err = s.agent.ServeDesktopModelSourceRPC(r.Context(), session, conn, s.notifyRuntimeServiceChanged)
	if err != nil && s.log != nil {
		s.log.Warn("desktop model source rpc closed", "error", logsafe.Error(err))
	}
}

func (s *runtimeControlServer) notifyProviderLinkChanged() {
	s.notifyRuntimeServiceChanged()
}

func (s *runtimeControlServer) notifyRuntimeServiceChanged() {
	if s == nil || s.afterChange == nil {
		return
	}
	s.afterChange()
}

func writeRuntimeControlAgentError(w http.ResponseWriter, err error) {
	var linkErr *agent.ProviderLinkError
	if errors.As(err, &linkErr) {
		status := http.StatusBadRequest
		if linkErr.Code == "PROVIDER_LINK_ACTIVE_WORK" || linkErr.Code == "PROVIDER_LINK_ALREADY_CONNECTED" {
			status = http.StatusConflict
		}
		if linkErr.Code == "PROVIDER_LINK_NOT_CURRENT" || linkErr.Code == "PROVIDER_LINK_DISCONNECT_REJECTED" {
			status = http.StatusConflict
		}
		writeRuntimeControlError(w, status, linkErr.Code, linkErr.Error())
		return
	}
	writeRuntimeControlError(w, http.StatusInternalServerError, "PROVIDER_LINK_FAILED", err.Error())
}

func writeRuntimeControlError(w http.ResponseWriter, status int, code string, message string) {
	writeRuntimeControlJSON(w, status, runtimeControlEnvelope{
		OK: false,
		Error: &runtimeControlError{
			Code:    strings.TrimSpace(code),
			Message: strings.TrimSpace(message),
		},
	})
}

func writeRuntimeControlJSON(w http.ResponseWriter, status int, body runtimeControlEnvelope) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
