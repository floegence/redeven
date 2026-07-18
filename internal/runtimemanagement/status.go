package runtimemanagement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/runtimeservice"
)

const StatusPath = "/v1/status"

type AttachState string

const (
	AttachStateReady                    AttachState = "ready"
	AttachStateStarting                 AttachState = "starting"
	AttachStateBlocked                  AttachState = "blocked"
	AttachStateUnhealthy                AttachState = "unhealthy"
	AttachStateLiveProcessWithoutSocket AttachState = "live_process_without_management_socket"
	AttachStateGenerationConflict       AttachState = "generation_conflict"
	AttachStateStaleLock                AttachState = "stale_lock"
	AttachStateNotRunning               AttachState = "not_running"
)

type RuntimeInstanceIdentity struct {
	InstanceID      string `json:"instance_id,omitempty"`
	StateRoot       string `json:"state_root,omitempty"`
	StateDir        string `json:"state_dir,omitempty"`
	PID             int    `json:"pid,omitempty"`
	StartedAtUnixMS int64  `json:"started_at_unix_ms,omitempty"`
	RuntimeVersion  string `json:"runtime_version,omitempty"`
	RuntimeCommit   string `json:"runtime_commit,omitempty"`
	BinaryPath      string `json:"binary_path,omitempty"`
	DesktopManaged  bool   `json:"desktop_managed"`
	DesktopOwnerID  string `json:"desktop_owner_id,omitempty"`
}

type RuntimeControlEndpoint struct {
	ProtocolVersion string `json:"protocol_version"`
	BaseURL         string `json:"base_url"`
	Token           string `json:"token"`
	DesktopOwnerID  string `json:"desktop_owner_id"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms,omitempty"`
}

type RuntimeAttachEndpoint struct {
	LocalUIURL       string                  `json:"local_ui_url,omitempty"`
	LocalUIURLs      []string                `json:"local_ui_urls,omitempty"`
	LocalUIBridgeURL string                  `json:"local_ui_bridge_url"`
	RuntimeControl   *RuntimeControlEndpoint `json:"runtime_control,omitempty"`
	PasswordRequired bool                    `json:"password_required"`
	Exposure         LocalUIExposure         `json:"exposure"`
}

type RuntimeAttachDiagnostics struct {
	LockPath          string `json:"lock_path,omitempty"`
	ControlSocketPath string `json:"control_socket_path,omitempty"`
	LockPID           int    `json:"lock_pid,omitempty"`
	LockInstanceID    string `json:"lock_instance_id,omitempty"`
	PIDAlive          bool   `json:"pid_alive,omitempty"`
	SocketReachable   bool   `json:"socket_reachable,omitempty"`
	FailureCode       string `json:"failure_code,omitempty"`
}

type RuntimeAttachStatus struct {
	State          AttachState              `json:"state"`
	Identity       RuntimeInstanceIdentity  `json:"identity,omitempty"`
	Endpoint       *RuntimeAttachEndpoint   `json:"endpoint,omitempty"`
	RuntimeService runtimeservice.Snapshot  `json:"runtime_service,omitempty"`
	Diagnostics    RuntimeAttachDiagnostics `json:"diagnostics,omitempty"`
	Message        string                   `json:"message,omitempty"`
}

func NormalizeLocalUIBridgeURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("URL must be an HTTP loopback endpoint")
	}
	if (parsed.Path != "" && parsed.Path != "/") || (parsed.RawPath != "" && parsed.RawPath != "/") {
		return "", errors.New("URL path must be root")
	}
	addrPort, err := netip.ParseAddrPort(parsed.Host)
	if err != nil || addrPort.Port() == 0 {
		return "", errors.New("URL must include a loopback host and port")
	}
	addr := addrPort.Addr()
	if !addr.IsLoopback() || addr.Zone() != "" || addr.Is4In6() {
		return "", errors.New("URL host must be loopback")
	}
	parsed.Host = addrPort.String()
	parsed.Path = "/"
	parsed.RawPath = ""
	return parsed.String(), nil
}

type StatusProvider func(context.Context) (RuntimeAttachStatus, error)

type Server struct {
	socketPath string
	provider   StatusProvider
	httpServer *http.Server
	listener   net.Listener
}

func NewServer(socketPath string, provider StatusProvider) (*Server, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return nil, errors.New("missing runtime management socket path")
	}
	if provider == nil {
		return nil, errors.New("missing runtime management status provider")
	}
	return &Server{socketPath: filepath.Clean(socketPath), provider: provider}, nil
}

func (s *Server) Start(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if s.listener != nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.socketPath), 0o700); err != nil {
		return err
	}
	if err := os.Remove(s.socketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	ln, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return err
	}
	if err := os.Chmod(s.socketPath, 0o600); err != nil {
		_ = ln.Close()
		return err
	}
	mux := http.NewServeMux()
	mux.HandleFunc(StatusPath, s.handleStatus)
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	s.httpServer = srv
	s.listener = ln
	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()
	go func() { _ = srv.Serve(ln) }()
	return nil
}

func (s *Server) Close() error {
	if s == nil {
		return nil
	}
	if s.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.httpServer.Shutdown(ctx)
	}
	if s.listener != nil {
		_ = s.listener.Close()
	}
	if strings.TrimSpace(s.socketPath) != "" {
		_ = os.Remove(s.socketPath)
	}
	s.httpServer = nil
	s.listener = nil
	return nil
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	status, err := s.provider(r.Context())
	if err != nil {
		status = RuntimeAttachStatus{
			State:   AttachStateUnhealthy,
			Message: strings.TrimSpace(err.Error()),
		}
	}
	if status.State == "" {
		status.State = AttachStateReady
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(status)
}

func LoadStatus(ctx context.Context, socketPath string, timeout time.Duration) (RuntimeAttachStatus, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return RuntimeAttachStatus{}, errors.New("missing runtime management socket path")
	}
	if timeout <= 0 {
		timeout = 300 * time.Millisecond
	}
	dialer := net.Dialer{Timeout: timeout}
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return dialer.DialContext(ctx, "unix", socketPath)
			},
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://runtime"+StatusPath, nil)
	if err != nil {
		return RuntimeAttachStatus{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return RuntimeAttachStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return RuntimeAttachStatus{}, fmt.Errorf("runtime management status returned HTTP %d", resp.StatusCode)
	}
	var status RuntimeAttachStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return RuntimeAttachStatus{}, err
	}
	if status.State == "" {
		status.State = AttachStateReady
	}
	return status, nil
}
