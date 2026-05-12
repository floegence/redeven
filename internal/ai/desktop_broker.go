package ai

import (
	"bufio"
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

const (
	DesktopBrokerProviderType     = "desktop_broker"
	desktopBrokerProviderIDPrefix = "desktop-broker:"

	defaultDesktopBrokerHTTPTimeout = 30 * time.Second
)

type DesktopAIBrokerEndpoint struct {
	URL                string
	SessionID          string
	Token              string
	SSHRuntimeKey      string
	ExpiresAtUnixMS    int64
	ModelSource        string
	LocalStateRootHint string
}

type DesktopAIBrokerStatus struct {
	Connected             bool     `json:"connected"`
	Available             bool     `json:"available"`
	ModelSource           string   `json:"model_source,omitempty"`
	SessionID             string   `json:"session_id,omitempty"`
	SSHRuntimeKey         string   `json:"ssh_runtime_key,omitempty"`
	ExpiresAtUnixMS       int64    `json:"expires_at_unix_ms,omitempty"`
	ModelCount            int      `json:"model_count"`
	MissingKeyProviderIDs []string `json:"missing_key_provider_ids,omitempty"`
	LastError             string   `json:"last_error,omitempty"`
}

type AIRuntimeStatus struct {
	RemoteConfigured bool                   `json:"remote_configured"`
	DesktopBroker    *DesktopAIBrokerStatus `json:"desktop_broker,omitempty"`
}

type DesktopBrokerModel struct {
	ID                            string `json:"id"`
	ProviderID                    string `json:"provider_id"`
	ProviderType                  string `json:"provider_type"`
	ModelName                     string `json:"model_name"`
	Label                         string `json:"label,omitempty"`
	ContextWindow                 int    `json:"context_window,omitempty"`
	MaxOutputTokens               int    `json:"max_output_tokens,omitempty"`
	EffectiveContextWindowPercent int    `json:"effective_context_window_percent,omitempty"`
}

type DesktopBrokerModelSnapshot struct {
	Configured            bool                 `json:"configured"`
	CurrentModel          string               `json:"current_model"`
	Models                []DesktopBrokerModel `json:"models"`
	MissingKeyProviderIDs []string             `json:"missing_key_provider_ids,omitempty"`
}

type DesktopAIBrokerServerOptions struct {
	Logger            *slog.Logger
	ConfigPath        string
	SecretsPath       string
	Bind              string
	Token             string
	SessionID         string
	SSHRuntimeKey     string
	ExpiresAtUnixMS   int64
	StartupReportFile string
}

type DesktopAIBrokerStartupReport struct {
	Status                string   `json:"status"`
	URL                   string   `json:"url"`
	PID                   int      `json:"pid"`
	Configured            bool     `json:"configured"`
	ModelCount            int      `json:"model_count"`
	MissingKeyProviderIDs []string `json:"missing_key_provider_ids,omitempty"`
}

type desktopAIBrokerClient struct {
	endpoint DesktopAIBrokerEndpoint
	client   *http.Client
}

type desktopAIBrokerProvider struct {
	client              *desktopAIBrokerClient
	defaultLocalModelID string
}

type desktopBrokerStreamRequest struct {
	Request TurnRequest `json:"request"`
}

type desktopBrokerStreamFrame struct {
	Type   string              `json:"type"`
	Event  *StreamEvent        `json:"event,omitempty"`
	Result *TurnResult         `json:"result,omitempty"`
	Error  *desktopBrokerError `json:"error,omitempty"`
}

type desktopBrokerError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

func newDesktopAIBrokerClient(endpoint *DesktopAIBrokerEndpoint) (*desktopAIBrokerClient, error) {
	if endpoint == nil {
		return nil, nil
	}
	normalized := DesktopAIBrokerEndpoint{
		URL:                strings.TrimSpace(endpoint.URL),
		SessionID:          strings.TrimSpace(endpoint.SessionID),
		Token:              strings.TrimSpace(endpoint.Token),
		SSHRuntimeKey:      strings.TrimSpace(endpoint.SSHRuntimeKey),
		ExpiresAtUnixMS:    endpoint.ExpiresAtUnixMS,
		ModelSource:        strings.TrimSpace(endpoint.ModelSource),
		LocalStateRootHint: strings.TrimSpace(endpoint.LocalStateRootHint),
	}
	if normalized.URL == "" {
		return nil, errors.New("missing desktop ai broker url")
	}
	if normalized.Token == "" {
		return nil, errors.New("missing desktop ai broker token")
	}
	u, err := url.Parse(normalized.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid desktop ai broker url: %w", err)
	}
	if u == nil || u.Scheme != "http" {
		return nil, errors.New("desktop ai broker url must use http loopback forwarding")
	}
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return nil, errors.New("desktop ai broker url must be loopback")
	}
	if normalized.ModelSource == "" {
		normalized.ModelSource = "desktop_local_environment"
	}
	return &desktopAIBrokerClient{
		endpoint: normalized,
		client: &http.Client{
			Timeout: defaultDesktopBrokerHTTPTimeout,
		},
	}, nil
}

func (c *desktopAIBrokerClient) endpointStatus(snapshot *DesktopBrokerModelSnapshot, lastErr error) *DesktopAIBrokerStatus {
	if c == nil {
		return nil
	}
	status := &DesktopAIBrokerStatus{
		Connected:       lastErr == nil,
		Available:       snapshot != nil && len(snapshot.Models) > 0,
		ModelSource:     firstNonEmpty(c.endpoint.ModelSource, "desktop_local_environment"),
		SessionID:       c.endpoint.SessionID,
		SSHRuntimeKey:   c.endpoint.SSHRuntimeKey,
		ExpiresAtUnixMS: c.endpoint.ExpiresAtUnixMS,
	}
	if snapshot != nil {
		status.ModelCount = len(snapshot.Models)
		status.MissingKeyProviderIDs = append([]string(nil), snapshot.MissingKeyProviderIDs...)
	}
	if lastErr != nil {
		status.LastError = strings.TrimSpace(lastErr.Error())
	}
	return status
}

func (c *desktopAIBrokerClient) Status(ctx context.Context) *DesktopAIBrokerStatus {
	if c == nil {
		return nil
	}
	req, err := c.newRequest(ctx, http.MethodGet, "/v1/status", nil)
	if err != nil {
		return c.endpointStatus(nil, err)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return c.endpointStatus(nil, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return c.endpointStatus(nil, decodeDesktopBrokerHTTPError(resp, "load desktop broker status"))
	}
	var out DesktopAIBrokerStatus
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return c.endpointStatus(nil, err)
	}
	out.Connected = true
	if out.ModelSource == "" {
		out.ModelSource = firstNonEmpty(c.endpoint.ModelSource, "desktop_local_environment")
	}
	if out.SessionID == "" {
		out.SessionID = c.endpoint.SessionID
	}
	if out.SSHRuntimeKey == "" {
		out.SSHRuntimeKey = c.endpoint.SSHRuntimeKey
	}
	if out.ExpiresAtUnixMS == 0 {
		out.ExpiresAtUnixMS = c.endpoint.ExpiresAtUnixMS
	}
	return &out
}

func (c *desktopAIBrokerClient) Provider(defaultLocalModelID string) Provider {
	if c == nil {
		return nil
	}
	return &desktopAIBrokerProvider{
		client:              c,
		defaultLocalModelID: strings.TrimSpace(defaultLocalModelID),
	}
}

func (c *desktopAIBrokerClient) ListModels(ctx context.Context) (*DesktopBrokerModelSnapshot, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	req, err := c.newRequest(ctx, http.MethodGet, "/v1/models", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, decodeDesktopBrokerHTTPError(resp, "list desktop broker models")
	}
	var out DesktopBrokerModelSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	sort.Strings(out.MissingKeyProviderIDs)
	return &out, nil
}

func (c *desktopAIBrokerClient) StreamTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if c == nil {
		return TurnResult{}, ErrNotConfigured
	}
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(desktopBrokerStreamRequest{Request: req}); err != nil {
		return TurnResult{}, err
	}
	httpReq, err := c.newRequest(ctx, http.MethodPost, "/v1/stream", &body)
	if err != nil {
		return TurnResult{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(httpReq)
	if err != nil {
		return TurnResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return TurnResult{}, decodeDesktopBrokerHTTPError(resp, "stream desktop broker turn")
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	var result *TurnResult
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var frame desktopBrokerStreamFrame
		if err := json.Unmarshal(line, &frame); err != nil {
			return TurnResult{}, err
		}
		switch strings.TrimSpace(frame.Type) {
		case "event":
			if frame.Event != nil && onEvent != nil {
				onEvent(*frame.Event)
			}
		case "result":
			if frame.Result != nil {
				cp := *frame.Result
				result = &cp
			}
		case "error":
			if frame.Error != nil {
				msg := strings.TrimSpace(frame.Error.Message)
				if msg == "" {
					msg = "desktop broker request failed"
				}
				return TurnResult{}, errors.New(msg)
			}
			return TurnResult{}, errors.New("desktop broker request failed")
		}
	}
	if err := scanner.Err(); err != nil {
		return TurnResult{}, err
	}
	if result == nil {
		return TurnResult{}, errors.New("desktop broker stream ended without a result")
	}
	return *result, nil
}

func (c *desktopAIBrokerClient) newRequest(ctx context.Context, method string, path string, body *bytes.Buffer) (*http.Request, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	base := strings.TrimRight(strings.TrimSpace(c.endpoint.URL), "/")
	if base == "" {
		return nil, errors.New("missing desktop ai broker url")
	}
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader(body.Bytes())
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.endpoint.Token)
	if c.endpoint.SessionID != "" {
		req.Header.Set("X-Redeven-AI-Broker-Session", c.endpoint.SessionID)
	}
	return req, nil
}

func (p *desktopAIBrokerProvider) StreamTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if p == nil || p.client == nil {
		return TurnResult{}, ErrNotConfigured
	}
	model := strings.TrimSpace(req.Model)
	if model == "" || !strings.Contains(model, "/") {
		model = strings.TrimSpace(p.defaultLocalModelID)
	}
	if local, ok := desktopBrokerLocalModelID(model); ok {
		model = local
	}
	if model == "" {
		return TurnResult{}, errors.New("missing desktop broker model")
	}
	req.Model = model
	return p.client.StreamTurn(ctx, req, onEvent)
}

func ServeDesktopAIBroker(ctx context.Context, opts DesktopAIBrokerServerOptions) error {
	token := strings.TrimSpace(opts.Token)
	if token == "" {
		return errors.New("missing desktop ai broker token")
	}
	bind := strings.TrimSpace(opts.Bind)
	if bind == "" {
		bind = "127.0.0.1:0"
	}
	ln, err := net.Listen("tcp", bind)
	if err != nil {
		return err
	}
	defer ln.Close()
	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok || addr == nil {
		return errors.New("desktop ai broker listener did not return a tcp address")
	}
	host := addr.IP.String()
	if host == "" || host == "<nil>" || host == "::" {
		host = "127.0.0.1"
	}
	if host == "::1" {
		host = "[::1]"
	}
	publicURL := fmt.Sprintf("http://%s:%d", host, addr.Port)

	srv := &desktopAIBrokerServer{
		log:             opts.Logger,
		configPath:      strings.TrimSpace(opts.ConfigPath),
		secretsPath:     strings.TrimSpace(opts.SecretsPath),
		token:           token,
		sessionID:       strings.TrimSpace(opts.SessionID),
		sshRuntimeKey:   strings.TrimSpace(opts.SSHRuntimeKey),
		expiresAtUnixMS: opts.ExpiresAtUnixMS,
	}
	if err := srv.writeStartupReport(opts.StartupReportFile, publicURL); err != nil {
		return err
	}

	httpSrv := &http.Server{
		Handler:           srv.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		errCh <- httpSrv.Serve(ln)
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
		if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return ctx.Err()
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

type desktopAIBrokerServer struct {
	log             *slog.Logger
	configPath      string
	secretsPath     string
	token           string
	sessionID       string
	sshRuntimeKey   string
	expiresAtUnixMS int64
}

func (s *desktopAIBrokerServer) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/status", s.handleStatus)
	mux.HandleFunc("/v1/models", s.handleModels)
	mux.HandleFunc("/v1/stream", s.handleStream)
	return mux
}

func (s *desktopAIBrokerServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeDesktopBrokerJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if !s.authorized(w, r) {
		return
	}
	snapshot, _, _, err := s.snapshot()
	if err != nil {
		writeDesktopBrokerJSON(w, http.StatusServiceUnavailable, desktopBrokerError{Code: "BROKER_NOT_CONFIGURED", Message: err.Error()})
		return
	}
	status := &DesktopAIBrokerStatus{
		Connected:             true,
		Available:             snapshot != nil && len(snapshot.Models) > 0,
		ModelSource:           "desktop_local_environment",
		SessionID:             s.sessionID,
		SSHRuntimeKey:         s.sshRuntimeKey,
		ExpiresAtUnixMS:       s.expiresAtUnixMS,
		ModelCount:            len(snapshot.Models),
		MissingKeyProviderIDs: append([]string(nil), snapshot.MissingKeyProviderIDs...),
	}
	writeDesktopBrokerJSON(w, http.StatusOK, status)
}

func (s *desktopAIBrokerServer) handleModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeDesktopBrokerJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if !s.authorized(w, r) {
		return
	}
	snapshot, _, _, err := s.snapshot()
	if err != nil {
		writeDesktopBrokerJSON(w, http.StatusServiceUnavailable, desktopBrokerError{Code: "BROKER_NOT_CONFIGURED", Message: err.Error()})
		return
	}
	writeDesktopBrokerJSON(w, http.StatusOK, snapshot)
}

func (s *desktopAIBrokerServer) handleStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeDesktopBrokerJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if !s.authorized(w, r) {
		return
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var body desktopBrokerStreamRequest
	if err := dec.Decode(&body); err != nil {
		writeDesktopBrokerJSON(w, http.StatusBadRequest, desktopBrokerError{Code: "INVALID_JSON", Message: "invalid json"})
		return
	}
	snapshot, cfg, secretStore, err := s.snapshot()
	if err != nil {
		writeDesktopBrokerJSON(w, http.StatusServiceUnavailable, desktopBrokerError{Code: "BROKER_NOT_CONFIGURED", Message: err.Error()})
		return
	}
	localModelID := strings.TrimSpace(body.Request.Model)
	if local, ok := desktopBrokerLocalModelID(localModelID); ok {
		localModelID = local
	}
	providerID, modelName, ok := strings.Cut(localModelID, "/")
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	if !ok || providerID == "" || modelName == "" || cfg == nil || cfg.AI == nil || !cfg.AI.IsAllowedModelID(localModelID) {
		writeDesktopBrokerJSON(w, http.StatusBadRequest, desktopBrokerError{Code: "MODEL_NOT_ALLOWED", Message: "model not allowed"})
		return
	}
	if !desktopBrokerSnapshotHasModel(snapshot, localModelID) {
		writeDesktopBrokerJSON(w, http.StatusServiceUnavailable, desktopBrokerError{Code: "MODEL_NOT_USABLE", Message: "desktop model is missing its local API key"})
		return
	}
	var providerCfg *config.AIProvider
	for i := range cfg.AI.Providers {
		if strings.TrimSpace(cfg.AI.Providers[i].ID) == providerID {
			providerCfg = &cfg.AI.Providers[i]
			break
		}
	}
	if providerCfg == nil {
		writeDesktopBrokerJSON(w, http.StatusBadRequest, desktopBrokerError{Code: "PROVIDER_NOT_FOUND", Message: "provider not found"})
		return
	}
	apiKey, ok, err := secretStore.GetAIProviderAPIKey(providerID)
	if err != nil {
		writeDesktopBrokerJSON(w, http.StatusServiceUnavailable, desktopBrokerError{Code: "KEY_LOOKUP_FAILED", Message: err.Error()})
		return
	}
	if !ok || strings.TrimSpace(apiKey) == "" {
		writeDesktopBrokerJSON(w, http.StatusServiceUnavailable, desktopBrokerError{Code: "MISSING_API_KEY", Message: "desktop provider is missing its local API key"})
		return
	}
	adapter, err := newProviderAdapter(strings.TrimSpace(providerCfg.Type), strings.TrimSpace(providerCfg.BaseURL), strings.TrimSpace(apiKey), providerCfg.StrictToolSchema)
	if err != nil {
		writeDesktopBrokerJSON(w, http.StatusServiceUnavailable, desktopBrokerError{Code: "PROVIDER_INIT_FAILED", Message: err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	flusher, _ := w.(http.Flusher)
	enc := json.NewEncoder(w)
	writeFrame := func(frame desktopBrokerStreamFrame) {
		_ = enc.Encode(frame)
		if flusher != nil {
			flusher.Flush()
		}
	}
	req := body.Request
	req.Model = modelName
	result, err := adapter.StreamTurn(r.Context(), req, func(ev StreamEvent) {
		writeFrame(desktopBrokerStreamFrame{Type: "event", Event: &ev})
	})
	if err != nil {
		writeFrame(desktopBrokerStreamFrame{Type: "error", Error: &desktopBrokerError{Code: "PROVIDER_STREAM_FAILED", Message: err.Error()}})
		return
	}
	writeFrame(desktopBrokerStreamFrame{Type: "result", Result: &result})
}

func (s *desktopAIBrokerServer) authorized(w http.ResponseWriter, r *http.Request) bool {
	if s.expiresAtUnixMS > 0 && time.Now().UnixMilli() > s.expiresAtUnixMS {
		writeDesktopBrokerJSON(w, http.StatusUnauthorized, desktopBrokerError{Code: "TOKEN_EXPIRED", Message: "desktop ai broker token expired"})
		return false
	}
	got := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(r.Header.Get("Authorization")), "Bearer "))
	if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
		writeDesktopBrokerJSON(w, http.StatusUnauthorized, desktopBrokerError{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return false
	}
	if s.sessionID != "" {
		gotSessionID := strings.TrimSpace(r.Header.Get("X-Redeven-AI-Broker-Session"))
		if gotSessionID == "" || subtle.ConstantTimeCompare([]byte(gotSessionID), []byte(s.sessionID)) != 1 {
			writeDesktopBrokerJSON(w, http.StatusUnauthorized, desktopBrokerError{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return false
		}
	}
	return true
}

func (s *desktopAIBrokerServer) snapshot() (*DesktopBrokerModelSnapshot, *config.Config, *settings.SecretsStore, error) {
	cfgPath := strings.TrimSpace(s.configPath)
	if cfgPath == "" {
		return nil, nil, nil, errors.New("missing config path")
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return &DesktopBrokerModelSnapshot{Configured: false}, nil, settings.NewSecretsStore(s.secretsPath), nil
	}
	secretStore := settings.NewSecretsStore(s.secretsPath)
	snapshot, err := buildDesktopBrokerModelSnapshot(cfg.AI, secretStore)
	if err != nil {
		return nil, nil, nil, err
	}
	return snapshot, cfg, secretStore, nil
}

func (s *desktopAIBrokerServer) writeStartupReport(reportFile string, publicURL string) error {
	reportFile = strings.TrimSpace(reportFile)
	if reportFile == "" {
		return nil
	}
	snapshot, _, _, err := s.snapshot()
	if err != nil {
		snapshot = &DesktopBrokerModelSnapshot{}
	}
	report := DesktopAIBrokerStartupReport{
		Status:                "ready",
		URL:                   strings.TrimSpace(publicURL),
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

func buildDesktopBrokerModelSnapshot(cfg *config.AIConfig, secretStore *settings.SecretsStore) (*DesktopBrokerModelSnapshot, error) {
	out := &DesktopBrokerModelSnapshot{Configured: cfg != nil}
	if cfg == nil {
		return out, nil
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
				return nil, err
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
			id := providerID + "/" + modelName
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out.Models = append(out.Models, DesktopBrokerModel{
				ID:                            id,
				ProviderID:                    providerID,
				ProviderType:                  strings.TrimSpace(p.Type),
				ModelName:                     modelName,
				Label:                         providerName + " / " + modelName,
				ContextWindow:                 m.ContextWindow,
				MaxOutputTokens:               m.MaxOutputTokens,
				EffectiveContextWindowPercent: m.EffectiveContextWindowPercent,
			})
		}
	}
	for id := range missing {
		out.MissingKeyProviderIDs = append(out.MissingKeyProviderIDs, id)
	}
	sort.Strings(out.MissingKeyProviderIDs)
	current := strings.TrimSpace(cfg.CurrentModelID)
	if current != "" && desktopBrokerSnapshotHasModel(out, current) {
		out.CurrentModel = current
	} else if len(out.Models) > 0 {
		out.CurrentModel = out.Models[0].ID
	}
	return out, nil
}

func desktopBrokerSnapshotHasModel(snapshot *DesktopBrokerModelSnapshot, localModelID string) bool {
	if snapshot == nil {
		return false
	}
	localModelID = strings.TrimSpace(localModelID)
	for _, m := range snapshot.Models {
		if strings.TrimSpace(m.ID) == localModelID {
			return true
		}
	}
	return false
}

func desktopBrokerWireModelID(localModelID string) (string, bool) {
	providerID, modelName, ok := strings.Cut(strings.TrimSpace(localModelID), "/")
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	if !ok || providerID == "" || modelName == "" {
		return "", false
	}
	return desktopBrokerProviderIDPrefix + providerID + "/" + modelName, true
}

func desktopBrokerLocalModelID(wireModelID string) (string, bool) {
	providerID, modelName, ok := strings.Cut(strings.TrimSpace(wireModelID), "/")
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	if !ok || providerID == "" || modelName == "" || !strings.HasPrefix(providerID, desktopBrokerProviderIDPrefix) {
		return "", false
	}
	localProviderID := strings.TrimSpace(strings.TrimPrefix(providerID, desktopBrokerProviderIDPrefix))
	if localProviderID == "" {
		return "", false
	}
	return localProviderID + "/" + modelName, true
}

func isDesktopBrokerModelID(modelID string) bool {
	_, ok := desktopBrokerLocalModelID(modelID)
	return ok
}

func isDesktopBrokerProviderID(providerID string) bool {
	return strings.HasPrefix(strings.TrimSpace(providerID), desktopBrokerProviderIDPrefix)
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

func decodeDesktopBrokerHTTPError(resp *http.Response, action string) error {
	if resp == nil {
		return errors.New(action + " failed")
	}
	var brokerErr desktopBrokerError
	_ = json.NewDecoder(resp.Body).Decode(&brokerErr)
	msg := strings.TrimSpace(brokerErr.Message)
	if msg == "" {
		msg = strings.TrimSpace(resp.Status)
	}
	if msg == "" {
		msg = action + " failed"
	}
	return errors.New(msg)
}

func writeDesktopBrokerJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
