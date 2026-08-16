package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/rpcutil"
	"github.com/floegence/redeven/internal/sys"
)

type runtimeServiceSnapshot struct {
	RuntimeVersion string `json:"runtime_version,omitempty"`
}

type connectArtifactEnvelope struct {
	ConnectArtifact             string          `json:"connect_artifact"`
	CriticalScopeProjectionJSON string          `json:"critical_scope_projection_json"`
	SpendScope                  localSpendScope `json:"spend_scope"`
	ChannelID                   string          `json:"channel_id"`
}

type localSpendScope struct {
	Receipt              string          `json:"receipt"`
	ArtifactDigestB64u   string          `json:"artifact_digest_b64u"`
	ProjectionDigestB64u string          `json:"projection_digest_b64u"`
	LauncherOrigin       string          `json:"launcher_origin"`
	RuntimeOrigin        string          `json:"runtime_origin"`
	AppOrigin            string          `json:"app_origin"`
	Consumer             string          `json:"consumer"`
	TargetBinding        json.RawMessage `json:"target_binding"`
	ExpiresAt            string          `json:"expires_at"`
}

type pingResponse struct {
	ServerTimeMs       int64                   `json:"server_time_ms,omitempty"`
	AgentInstanceID    string                  `json:"agent_instance_id,omitempty"`
	ProcessStartedAtMs int64                   `json:"process_started_at_ms,omitempty"`
	Version            string                  `json:"version,omitempty"`
	Commit             string                  `json:"commit,omitempty"`
	RuntimeService     *runtimeServiceSnapshot `json:"runtime_service,omitempty"`
}

type commandResult struct {
	Action       string                      `json:"action"`
	Ping         *pingResponse               `json:"ping,omitempty"`
	Restart      *sys.RestartResponse        `json:"restart,omitempty"`
	Upgrade      *sys.UpgradeResponse        `json:"upgrade,omitempty"`
	NetworkCheck *networkExposureCheckResult `json:"network_check,omitempty"`
}

type localUIExposure struct {
	Scope            string `json:"scope"`
	Transport        string `json:"transport"`
	PasswordRequired bool   `json:"password_required"`
}

type accessStatus struct {
	PasswordRequired bool            `json:"password_required"`
	Unlocked         bool            `json:"unlocked"`
	Exposure         localUIExposure `json:"exposure"`
	URLs             []string        `json:"urls"`
}

type apiEnvelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type networkExposureCheckResult struct {
	AccessStatus           accessStatus `json:"access_status"`
	EnvAppLoaded           bool         `json:"env_app_loaded"`
	WrongHostStatus        int          `json:"wrong_host_status"`
	DirectArtifactRejected bool         `json:"direct_artifact_rejected"`
}

func main() {
	baseURL := flag.String("base-url", "", "Local UI base URL.")
	action := flag.String("action", "ping", "Action: ping, restart, upgrade, or network-check.")
	targetVersion := flag.String("target-version", "", "Target version for upgrade.")
	password := flag.String("password", "", "Local UI password for authenticated network checks.")
	flag.Parse()

	if err := run(*baseURL, *action, *targetVersion, *password); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run(baseURL string, action string, targetVersion string, password string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if strings.TrimSpace(action) == "network-check" {
		result, err := verifyNetworkExposure(ctx, baseURL, password)
		if err != nil {
			return err
		}
		return printResult(commandResult{Action: "network-check", NetworkCheck: result})
	}

	httpClient, parsedBase, err := newHTTPClient(baseURL)
	if err != nil {
		return err
	}
	if strings.TrimSpace(password) != "" {
		if err := unlockLocalUI(ctx, httpClient, parsedBase, password); err != nil {
			return err
		}
	}
	acquisition, origin, err := mintConnectArtifact(ctx, httpClient, parsedBase)
	if err != nil {
		return err
	}
	session, err := connectFlowersecSession(ctx, httpClient, parsedBase, acquisition, origin)
	if err != nil {
		return fmt.Errorf("connect direct session: %w", err)
	}
	defer func() { _ = session.Close() }()

	result := commandResult{Action: strings.TrimSpace(action)}
	switch result.Action {
	case "ping":
		ping, err := rpcutil.CallJSON[struct{}, pingResponse](ctx, session.RPC(), sys.TypeID_SYS_PING, &struct{}{})
		if err != nil {
			return rpcActionError("sys.ping", err)
		}
		result.Ping = ping
	case "restart":
		resp, err := rpcutil.CallJSON[sys.RestartRequest, sys.RestartResponse](ctx, session.RPC(), sys.TypeID_SYS_RESTART, &sys.RestartRequest{})
		if err != nil {
			return rpcActionError("sys.restart", err)
		}
		result.Restart = resp
	case "upgrade":
		resp, err := rpcutil.CallJSON[sys.UpgradeRequest, sys.UpgradeResponse](ctx, session.RPC(), sys.TypeID_SYS_UPGRADE, &sys.UpgradeRequest{
			TargetVersion: strings.TrimSpace(targetVersion),
		})
		if err != nil {
			return rpcActionError("sys.upgrade", err)
		}
		result.Upgrade = resp
	default:
		return fmt.Errorf("unknown action %q", action)
	}

	return printResult(result)
}

func rpcActionError(action string, err error) error {
	var application *flowersec.RPCError
	if errors.As(err, &application) && application != nil {
		return fmt.Errorf("%s: %s (code=%d)", action, application.Message, application.Code)
	}
	return fmt.Errorf("%s: %w", action, err)
}

func printResult(result commandResult) error {
	body, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

func newHTTPClient(baseURL string) (*http.Client, *url.URL, error) {
	parsedBase, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, nil, fmt.Errorf("parse base URL: %w", err)
	}
	if parsedBase.Scheme == "" || parsedBase.Host == "" {
		return nil, nil, fmt.Errorf("base URL must include scheme and host")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, nil, fmt.Errorf("create cookie jar: %w", err)
	}
	return &http.Client{Jar: jar}, parsedBase, nil
}

func unlockLocalUI(ctx context.Context, client *http.Client, parsedBase *url.URL, password string) error {
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/access/unlock"})
	body, err := json.Marshal(map[string]string{"password": password})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("POST access unlock: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("POST access unlock returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func readAccessStatus(ctx context.Context, client *http.Client, parsedBase *url.URL) (accessStatus, error) {
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/access/status"})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return accessStatus{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return accessStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return accessStatus{}, fmt.Errorf("GET access status returned HTTP %d", resp.StatusCode)
	}
	var envelope apiEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return accessStatus{}, err
	}
	var status accessStatus
	if !envelope.OK || json.Unmarshal(envelope.Data, &status) != nil {
		return accessStatus{}, fmt.Errorf("invalid access status response")
	}
	return status, nil
}

func loadEnvApp(ctx context.Context, client *http.Client, parsedBase *url.URL) error {
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/_redeven_proxy/env/"})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK || !bytes.Contains(bytes.ToLower(body), []byte("<html")) {
		return fmt.Errorf("Env App load returned HTTP %d without HTML", resp.StatusCode)
	}
	return nil
}

func requestWithWrongHost(ctx context.Context, client *http.Client, parsedBase *url.URL) (int, error) {
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/access/status"})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return 0, err
	}
	req.Host = "evil.example.invalid:" + parsedBase.Port()
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func verifyNetworkExposure(ctx context.Context, baseURL string, password string) (*networkExposureCheckResult, error) {
	client, parsedBase, err := newHTTPClient(baseURL)
	if err != nil {
		return nil, err
	}
	status, err := readAccessStatus(ctx, client, parsedBase)
	if err != nil {
		return nil, err
	}
	if !status.PasswordRequired || status.Unlocked || status.Exposure.Scope != "network" || status.Exposure.Transport != "plaintext" || !status.Exposure.PasswordRequired {
		return nil, fmt.Errorf("unexpected locked network exposure status: %#v", status)
	}
	if err := loadEnvApp(ctx, client, parsedBase); err != nil {
		return nil, err
	}
	wrongHostStatus, err := requestWithWrongHost(ctx, client, parsedBase)
	if err != nil {
		return nil, err
	}
	if wrongHostStatus != http.StatusMisdirectedRequest {
		return nil, fmt.Errorf("wrong Host returned HTTP %d", wrongHostStatus)
	}
	if err := unlockLocalUI(ctx, client, parsedBase, password); err != nil {
		return nil, err
	}
	directStatus, err := requestConnectArtifactStatus(ctx, client, parsedBase)
	if err != nil {
		return nil, err
	}
	if directStatus != http.StatusForbidden {
		return nil, fmt.Errorf("plaintext network connect artifact returned HTTP %d", directStatus)
	}
	return &networkExposureCheckResult{
		AccessStatus:           status,
		EnvAppLoaded:           true,
		WrongHostStatus:        wrongHostStatus,
		DirectArtifactRejected: true,
	}, nil
}

func requestConnectArtifactStatus(ctx context.Context, client *http.Client, parsedBase *url.URL) (int, error) {
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/direct/connect_artifact"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewBufferString(`{}`))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", parsedBase.Scheme+"://"+parsedBase.Host)
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("POST connect_artifact: %w", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func mintConnectArtifact(ctx context.Context, client *http.Client, parsedBase *url.URL) (connectArtifactEnvelope, string, error) {
	origin := parsedBase.Scheme + "://" + parsedBase.Host
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/direct/connect_artifact"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewBufferString(`{}`))
	if err != nil {
		return connectArtifactEnvelope{}, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	resp, err := client.Do(req)
	if err != nil {
		return connectArtifactEnvelope{}, "", fmt.Errorf("POST connect_artifact: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return connectArtifactEnvelope{}, "", fmt.Errorf("POST connect_artifact returned HTTP %d", resp.StatusCode)
	}
	var envelope connectArtifactEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return connectArtifactEnvelope{}, "", fmt.Errorf("decode connect artifact envelope: %w", err)
	}
	if strings.TrimSpace(envelope.ConnectArtifact) == "" || strings.TrimSpace(envelope.SpendScope.Receipt) == "" {
		return connectArtifactEnvelope{}, "", errors.New("connect artifact envelope is incomplete")
	}
	return envelope, origin, nil
}

func connectFlowersecSession(ctx context.Context, client *http.Client, parsedBase *url.URL, acquisition connectArtifactEnvelope, origin string) (flowersec.Session, error) {
	artifact, err := flowersec.ParseArtifact([]byte(acquisition.ConnectArtifact))
	if err != nil {
		return nil, fmt.Errorf("decode connect artifact: %w", err)
	}
	endpoint, err := url.Parse(strings.TrimSpace(origin))
	if err != nil {
		return nil, fmt.Errorf("parse Local UI origin: %w", err)
	}
	trustRoots, err := connectorTrustRoots(endpoint, x509.SystemCertPool)
	if err != nil {
		return nil, err
	}
	attemptBytes := make([]byte, 32)
	if _, err := rand.Read(attemptBytes); err != nil {
		return nil, fmt.Errorf("create artifact spend attempt: %w", err)
	}
	attemptID := base64.RawURLEncoding.EncodeToString(attemptBytes)
	lease, err := flowersec.NewArtifactLease(artifact, func(spendCtx context.Context) error {
		return commitArtifactSpend(spendCtx, client, parsedBase, origin, attemptID, acquisition.SpendScope)
	})
	if err != nil {
		return nil, err
	}
	return flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: trustRoots, Origin: origin, ConnectTimeout: 15 * time.Second})
}

func commitArtifactSpend(ctx context.Context, client *http.Client, parsedBase *url.URL, origin, attemptID string, scope localSpendScope) error {
	if client == nil || parsedBase == nil {
		return errors.New("Local UI artifact spend client is unavailable")
	}
	payload, err := json.Marshal(struct {
		AttemptID            string          `json:"attempt_id"`
		Receipt              string          `json:"receipt"`
		ArtifactDigestB64u   string          `json:"artifact_digest_b64u"`
		ProjectionDigestB64u string          `json:"projection_digest_b64u"`
		LauncherOrigin       string          `json:"launcher_origin"`
		RuntimeOrigin        string          `json:"runtime_origin"`
		AppOrigin            string          `json:"app_origin"`
		Consumer             string          `json:"consumer"`
		TargetBinding        json.RawMessage `json:"target_binding"`
		ExpiresAt            string          `json:"expires_at"`
	}{
		AttemptID: attemptID, Receipt: scope.Receipt,
		ArtifactDigestB64u: scope.ArtifactDigestB64u, ProjectionDigestB64u: scope.ProjectionDigestB64u,
		LauncherOrigin: scope.LauncherOrigin, RuntimeOrigin: scope.RuntimeOrigin, AppOrigin: scope.AppOrigin,
		Consumer: scope.Consumer, TargetBinding: scope.TargetBinding, ExpiresAt: scope.ExpiresAt,
	})
	if err != nil {
		return fmt.Errorf("encode artifact spend: %w", err)
	}
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/direct/artifact/spend"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("POST artifact spend: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("POST artifact spend returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func connectorTrustRoots(endpoint *url.URL, loadSystemRoots func() (*x509.CertPool, error)) (*x509.CertPool, error) {
	if endpoint == nil || strings.TrimSpace(endpoint.Hostname()) == "" {
		return nil, errors.New("Local UI endpoint is unavailable")
	}
	switch strings.ToLower(strings.TrimSpace(endpoint.Scheme)) {
	case "http":
		host := net.ParseIP(endpoint.Hostname())
		if host == nil || !host.IsLoopback() {
			return nil, errors.New("plaintext Flowersec direct sessions require an IP loopback endpoint")
		}
		return nil, nil
	case "https":
		trustRoots, err := loadSystemRoots()
		if err != nil {
			return nil, fmt.Errorf("load system trust roots: %w", err)
		}
		if trustRoots == nil {
			return nil, errors.New("system trust roots unavailable")
		}
		return trustRoots, nil
	default:
		return nil, errors.New("Local UI endpoint must use HTTP or HTTPS")
	}
}
