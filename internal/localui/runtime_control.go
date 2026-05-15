package localui

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/agent"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

const runtimeControlProtocolVersion = "redeven-runtime-control-v1"

type runtimeControlServer struct {
	log            logger
	agent          *agent.Agent
	desktopOwnerID string
	afterChange    func()
	token          string
	ln             net.Listener
	srv            *http.Server
}

type logger interface {
	Warn(msg string, args ...any)
	Info(msg string, args ...any)
}

func newRuntimeControlServer(a *agent.Agent, desktopOwnerID string, log logger, afterChange func()) (*runtimeControlServer, error) {
	desktopOwnerID = strings.TrimSpace(desktopOwnerID)
	if a == nil {
		return nil, errors.New("missing Agent")
	}
	if desktopOwnerID == "" {
		return nil, errors.New("missing Desktop owner id")
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, err
	}
	token := "rtctl_" + base64.RawURLEncoding.EncodeToString(tokenBytes)
	return &runtimeControlServer{
		log:            log,
		agent:          a,
		desktopOwnerID: desktopOwnerID,
		afterChange:    afterChange,
		token:          token,
	}, nil
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
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/provider-link", s.handleProviderLink)
	mux.HandleFunc("/v1/provider-link/connect", s.handleProviderLinkConnect)
	mux.HandleFunc("/v1/provider-link/disconnect", s.handleProviderLinkDisconnect)
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
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
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/provider-link", s.handleProviderLink)
	mux.HandleFunc("/v1/provider-link/connect", s.handleProviderLinkConnect)
	mux.HandleFunc("/v1/provider-link/disconnect", s.handleProviderLinkDisconnect)
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
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

func (s *runtimeControlServer) Endpoint() *localuiruntime.RuntimeControlEndpoint {
	if s == nil || s.ln == nil {
		return nil
	}
	addr, ok := s.ln.Addr().(*net.TCPAddr)
	if !ok || addr.Port <= 0 {
		return nil
	}
	return &localuiruntime.RuntimeControlEndpoint{
		ProtocolVersion: runtimeControlProtocolVersion,
		BaseURL:         fmt.Sprintf("http://127.0.0.1:%d", addr.Port),
		Token:           s.token,
		DesktopOwnerID:  s.desktopOwnerID,
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
	if strings.TrimSpace(r.Header.Get("X-Redeven-Desktop-Owner-ID")) != s.desktopOwnerID {
		writeRuntimeControlError(w, http.StatusForbidden, "DESKTOP_OWNER_MISMATCH", "Desktop owner does not match this runtime.")
		return false
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth != "Bearer "+s.token {
		writeRuntimeControlError(w, http.StatusUnauthorized, "RUNTIME_CONTROL_UNAUTHORIZED", "Runtime control token is invalid.")
		return false
	}
	return true
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
	BootstrapTicket        string `json:"bootstrap_ticket"`
	AllowRelinkWhenIdle    bool   `json:"allow_relink_when_idle"`
	ExpectedCurrentBinding *struct {
		ProviderOrigin    string `json:"provider_origin"`
		ProviderID        string `json:"provider_id"`
		EnvPublicID       string `json:"env_public_id"`
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
		BootstrapTicket:     body.BootstrapTicket,
		AllowRelinkWhenIdle: body.AllowRelinkWhenIdle,
	}
	if body.ExpectedCurrentBinding != nil {
		req.ExpectedProviderOrigin = body.ExpectedCurrentBinding.ProviderOrigin
		req.ExpectedProviderID = body.ExpectedCurrentBinding.ProviderID
		req.ExpectedEnvPublicID = body.ExpectedCurrentBinding.EnvPublicID
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

func (s *runtimeControlServer) notifyProviderLinkChanged() {
	if s == nil || s.afterChange == nil {
		return
	}
	s.afterChange()
}

func writeRuntimeControlAgentError(w http.ResponseWriter, err error) {
	var linkErr *agent.ProviderLinkError
	if errors.As(err, &linkErr) {
		status := http.StatusBadRequest
		if linkErr.Code == "LOCAL_RUNTIME_NOT_DESKTOP_MANAGED" || linkErr.Code == "DESKTOP_OWNER_MISMATCH" {
			status = http.StatusForbidden
		}
		if linkErr.Code == "PROVIDER_LINK_ACTIVE_WORK" || linkErr.Code == "PROVIDER_LINK_ALREADY_CONNECTED" {
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
