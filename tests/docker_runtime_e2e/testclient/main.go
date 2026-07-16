package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"

	fsclient "github.com/floegence/flowersec/flowersec-go/client"
	"github.com/floegence/flowersec/flowersec-go/protocolio"
	"github.com/floegence/redeven/internal/rpcutil"
	"github.com/floegence/redeven/internal/sys"
)

type runtimeServiceSnapshot struct {
	RuntimeVersion string `json:"runtime_version,omitempty"`
}

type connectArtifactEnvelope struct {
	ConnectArtifact json.RawMessage `json:"connect_artifact"`
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
	AccessStatus          accessStatus  `json:"access_status"`
	EnvAppLoaded          bool          `json:"env_app_loaded"`
	WrongHostStatus       int           `json:"wrong_host_status"`
	WrongOriginWSRejected bool          `json:"wrong_origin_ws_rejected"`
	Ping                  *pingResponse `json:"ping,omitempty"`
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
	artifact, origin, err := mintConnectArtifact(ctx, httpClient, parsedBase)
	if err != nil {
		return err
	}
	policy, err := transportSecurityPolicyForHost(parsedBase.Hostname())
	if err != nil {
		return err
	}
	session, err := fsclient.Connect(ctx, artifact,
		fsclient.WithOrigin(origin),
		fsclient.WithHeader(webSocketCookieHeader(httpClient, parsedBase)),
		fsclient.WithTransportSecurityPolicy(policy),
	)
	if err != nil {
		return fmt.Errorf("connect direct session: %w", err)
	}
	defer func() { _ = session.Close() }()

	result := commandResult{Action: strings.TrimSpace(action)}
	switch result.Action {
	case "ping":
		ping, err := rpcutil.CallJSON[struct{}, pingResponse](ctx, session.RPC(), sys.TypeID_SYS_PING, &struct{}{})
		if err != nil {
			return fmt.Errorf("sys.ping: %w", err)
		}
		result.Ping = ping
	case "restart":
		resp, err := rpcutil.CallJSON[sys.RestartRequest, sys.RestartResponse](ctx, session.RPC(), sys.TypeID_SYS_RESTART, &sys.RestartRequest{})
		if err != nil {
			return fmt.Errorf("sys.restart: %w", err)
		}
		result.Restart = resp
	case "upgrade":
		resp, err := rpcutil.CallJSON[sys.UpgradeRequest, sys.UpgradeResponse](ctx, session.RPC(), sys.TypeID_SYS_UPGRADE, &sys.UpgradeRequest{
			TargetVersion: strings.TrimSpace(targetVersion),
		})
		if err != nil {
			return fmt.Errorf("sys.upgrade: %w", err)
		}
		result.Upgrade = resp
	default:
		return fmt.Errorf("unknown action %q", action)
	}

	return printResult(result)
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

func transportSecurityPolicyForHost(host string) (fsclient.TransportSecurityPolicy, error) {
	addr, err := netip.ParseAddr(strings.TrimSpace(host))
	if err != nil {
		return nil, fmt.Errorf("Local UI host must be an IP literal: %w", err)
	}
	if addr.IsLoopback() {
		return fsclient.AllowPlaintextForLoopback, nil
	}
	return fsclient.NewNetworkPlaintextPolicy(fsclient.NetworkPlaintextPolicyOptions{
		AllowedHosts:   []string{addr.String()},
		RiskAcceptance: fsclient.PlaintextRiskAcceptPreE2ECredentialExposure,
	})
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

func webSocketCookieHeader(client *http.Client, parsedBase *url.URL) http.Header {
	header := make(http.Header)
	if client == nil || client.Jar == nil || parsedBase == nil {
		return header
	}
	cookies := client.Jar.Cookies(parsedBase)
	parts := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		parts = append(parts, cookie.Name+"="+cookie.Value)
	}
	if len(parts) > 0 {
		header.Set("Cookie", strings.Join(parts, "; "))
	}
	return header
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
	artifact, origin, err := mintConnectArtifact(ctx, client, parsedBase)
	if err != nil {
		return nil, err
	}
	policy, err := transportSecurityPolicyForHost(parsedBase.Hostname())
	if err != nil {
		return nil, err
	}
	cookieHeader := webSocketCookieHeader(client, parsedBase)
	session, err := fsclient.Connect(ctx, artifact,
		fsclient.WithOrigin(origin),
		fsclient.WithHeader(cookieHeader),
		fsclient.WithTransportSecurityPolicy(policy),
	)
	if err != nil {
		return nil, fmt.Errorf("connect network direct session: %w", err)
	}
	ping, err := rpcutil.CallJSON[struct{}, pingResponse](ctx, session.RPC(), sys.TypeID_SYS_PING, &struct{}{})
	_ = session.Close()
	if err != nil {
		return nil, fmt.Errorf("network sys.ping: %w", err)
	}
	wrongOriginArtifact, _, err := mintConnectArtifact(ctx, client, parsedBase)
	if err != nil {
		return nil, err
	}
	_, wrongOriginErr := fsclient.Connect(ctx, wrongOriginArtifact,
		fsclient.WithOrigin("http://evil.example.invalid"),
		fsclient.WithHeader(cookieHeader),
		fsclient.WithTransportSecurityPolicy(policy),
	)
	if wrongOriginErr == nil {
		return nil, fmt.Errorf("wrong Origin unexpectedly established a Direct session")
	}
	return &networkExposureCheckResult{
		AccessStatus:          status,
		EnvAppLoaded:          true,
		WrongHostStatus:       wrongHostStatus,
		WrongOriginWSRejected: true,
		Ping:                  ping,
	}, nil
}

func mintConnectArtifact(ctx context.Context, client *http.Client, parsedBase *url.URL) (*protocolio.ConnectArtifact, string, error) {
	origin := parsedBase.Scheme + "://" + parsedBase.Host
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/direct/connect_artifact"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewBufferString(`{}`))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("POST connect_artifact: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("POST connect_artifact returned HTTP %d", resp.StatusCode)
	}
	var envelope connectArtifactEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, "", fmt.Errorf("decode connect artifact envelope: %w", err)
	}
	artifact, err := protocolio.DecodeConnectArtifactJSON(bytes.NewReader(envelope.ConnectArtifact))
	if err != nil {
		return nil, "", fmt.Errorf("decode connect artifact: %w", err)
	}
	return artifact, origin, nil
}
