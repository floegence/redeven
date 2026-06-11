package flowerhost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

type Server struct {
	service  *Service
	token    string
	server   *http.Server
	listener net.Listener
}

type ServerOptions struct {
	Service *Service
	Token   string
	Bind    string
}

func StartServer(opts ServerOptions) (*Server, error) {
	if opts.Service == nil {
		return nil, errors.New("missing Flower Host service")
	}
	token := strings.TrimSpace(opts.Token)
	if token == "" {
		generated, err := randomToken("fh_", 24)
		if err != nil {
			return nil, err
		}
		token = generated
	}
	bind := strings.TrimSpace(opts.Bind)
	if bind == "" {
		bind = "127.0.0.1:0"
	}
	listener, err := net.Listen("tcp", bind)
	if err != nil {
		return nil, err
	}
	srv := &Server{
		service:  opts.Service,
		token:    token,
		listener: listener,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/status", srv.handleStatus)
	mux.HandleFunc("/v1/settings", srv.handleSettings)
	mux.HandleFunc("/v1/router/resolve", srv.handleResolve)
	mux.HandleFunc("/v1/router/switch", srv.handleSwitch)
	mux.HandleFunc("/v1/threads", srv.handleThreads)
	mux.HandleFunc("/v1/thread/", srv.handleThreadDetail)
	mux.HandleFunc("/v1/chat/send", srv.handleSend)
	mux.HandleFunc("/v1/chat/input", srv.handleSubmitInput)
	srv.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		_ = srv.server.Serve(listener)
	}()
	return srv, nil
}

func (s *Server) BaseURL() string {
	if s == nil || s.listener == nil {
		return ""
	}
	return "http://" + s.listener.Addr().String()
}

func (s *Server) Token() string {
	if s == nil {
		return ""
	}
	return s.token
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s == nil || s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func (s *Server) authorized(w http.ResponseWriter, r *http.Request) bool {
	if strings.TrimSpace(s.token) == "" {
		return true
	}
	if strings.TrimSpace(r.Header.Get("authorization")) == "Bearer "+s.token {
		return true
	}
	writeErrorResponse(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
	return false
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	snapshot, _ := s.service.LoadSettings(r.Context())
	carrier := s.service.CarrierHealth(r.Context())
	status := map[string]any{
		"presence":    s.service.router.Presence(),
		"configured":  snapshot.Config.Enabled && len(snapshot.Config.Providers) > 0,
		"model_count": countModels(snapshot.Config),
		"carrier":     carrier,
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"ok":     true,
		"data":   status,
		"status": status,
	})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		snapshot, err := s.service.LoadSettings(r.Context())
		writeResult(w, snapshot, err)
	case http.MethodPut:
		var draft SettingsDraft
		if err := json.NewDecoder(r.Body).Decode(&draft); err != nil {
			writeErrorResponse(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		snapshot, err := s.service.SaveSettings(r.Context(), draft)
		writeResult(w, snapshot, err)
	default:
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var req ResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	decision, err := s.service.Resolve(r.Context(), req)
	writeResult(w, decision, err)
}

func (s *Server) handleSwitch(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var req HandlerSwitchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	decision, err := s.service.SwitchHandler(r.Context(), req)
	writeResult(w, decision, err)
}

func (s *Server) handleThreads(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	threads, err := s.service.ListThreads(r.Context())
	writeResult(w, threads, err)
}

func (s *Server) handleThreadDetail(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	threadID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/thread/"))
	if threadID == "" || strings.Contains(threadID, "/") {
		writeErrorResponse(w, http.StatusBadRequest, "missing_thread_id", "missing thread id")
		return
	}
	thread, err := s.service.GetThread(r.Context(), threadID)
	writeResult(w, thread, err)
}

func (s *Server) handleSend(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var req ChatSendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	result, err := s.service.SendChat(r.Context(), req)
	writeResult(w, result, err)
}

func (s *Server) handleSubmitInput(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeErrorResponse(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var req ChatSubmitInputRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	result, err := s.service.SubmitInput(r.Context(), req)
	writeResult(w, result, err)
}

func writeResult(w http.ResponseWriter, value any, err error) {
	if err != nil {
		status := http.StatusBadRequest
		code := "flower_host_error"
		var coded codedServiceError
		if errors.As(err, &coded) {
			status = coded.HTTPStatus()
			code = coded.ErrorCode()
		}
		writeErrorResponse(w, status, code, err.Error())
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"ok": true, "data": value})
}

func writeErrorResponse(w http.ResponseWriter, status int, code string, message string) {
	code = strings.TrimSpace(code)
	if code == "" {
		code = "flower_host_error"
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = "Flower Host request failed."
	}
	writeJSONResponse(w, status, map[string]any{
		"ok": false,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
}

func writeJSONResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		_, _ = fmt.Fprintf(w, `{"ok":false,"error":%q}`+"\n", err.Error())
	}
}

func countModels(doc ConfigDocument) int {
	count := 0
	for _, provider := range doc.Providers {
		count += len(provider.Models)
	}
	return count
}
