package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	fsclient "github.com/floegence/flowersec/flowersec-go/client"
	"github.com/floegence/flowersec/flowersec-go/protocolio"
	"github.com/floegence/redeven/internal/rpcutil"
	"github.com/floegence/redeven/internal/sys"
)

type connectArtifactEnvelope struct {
	ConnectArtifact json.RawMessage `json:"connect_artifact"`
}

type pingResponse struct {
	ServerTimeMs       int64  `json:"server_time_ms,omitempty"`
	AgentInstanceID    string `json:"agent_instance_id,omitempty"`
	ProcessStartedAtMs int64  `json:"process_started_at_ms,omitempty"`
	Version            string `json:"version,omitempty"`
	Commit             string `json:"commit,omitempty"`
}

type commandResult struct {
	Action  string               `json:"action"`
	Ping    *pingResponse        `json:"ping,omitempty"`
	Restart *sys.RestartResponse `json:"restart,omitempty"`
	Upgrade *sys.UpgradeResponse `json:"upgrade,omitempty"`
}

func main() {
	baseURL := flag.String("base-url", "", "Local UI base URL.")
	action := flag.String("action", "ping", "Action: ping, restart, or upgrade.")
	targetVersion := flag.String("target-version", "", "Target version for upgrade.")
	flag.Parse()

	if err := run(*baseURL, *action, *targetVersion); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run(baseURL string, action string, targetVersion string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	artifact, origin, err := mintConnectArtifact(ctx, baseURL)
	if err != nil {
		return err
	}
	session, err := fsclient.Connect(ctx, artifact, fsclient.WithOrigin(origin))
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

	body, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

func mintConnectArtifact(ctx context.Context, baseURL string) (*protocolio.ConnectArtifact, string, error) {
	parsedBase, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, "", fmt.Errorf("parse base URL: %w", err)
	}
	if parsedBase.Scheme == "" || parsedBase.Host == "" {
		return nil, "", fmt.Errorf("base URL must include scheme and host")
	}
	origin := parsedBase.Scheme + "://" + parsedBase.Host
	endpoint := parsedBase.ResolveReference(&url.URL{Path: "/api/local/direct/connect_artifact"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewBufferString(`{}`))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	resp, err := http.DefaultClient.Do(req)
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
