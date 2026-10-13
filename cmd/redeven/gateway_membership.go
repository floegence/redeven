package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/term"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/lockfile"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

const gatewayMembershipHelp = `Usage: redeven gateway <join|replace|update-endpoints|status|retry|leave|publish> [flags]

  --state-root PATH        Runtime state root
  --gateway ADDRESS       Administrator-confirmed HTTPS Gateway address
  --code-stdin --yes       Read the invitation code from stdin and confirm for automation
  --gateway-id ID         Select a paired Gateway for retry, leave or publish

Joining adds Gateway access without changing Cloud ownership.
A Runtime can pair with multiple Gateways. Startup reconnects each saved member.
Cloud publication remains subject to Gateway policy and Namespace authorization.
Leave disables local access first and durably retries Gateway removal.
`

func (c *cli) gatewayCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, gatewayMembershipHelp)
		return 0
	}
	action := args[0]
	if action != "join" && action != "replace" && action != "update-endpoints" && action != "status" && action != "retry" && action != "leave" && action != "publish" {
		writeText(c.stderr, gatewayMembershipHelp)
		return 2
	}
	flags := newCLIFlagSet("gateway " + action)
	root := flags.String("state-root", "", "Runtime state root")
	gatewayID := flags.String("gateway-id", "", "Gateway identity for retry or leave")
	address := flags.String("gateway", "", "Gateway HTTPS address")
	codeStdin := flags.Bool("code-stdin", false, "Read the invitation code from stdin")
	yes := flags.Bool("yes", false, "Confirm verified Gateway enrollment")
	if err := parseCommandFlags(flags, args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, gatewayMembershipHelp)
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 || (action == "join" || action == "replace" || action == "update-endpoints") != (*address != "") || (*codeStdin && !*yes) || ((action != "join" && action != "replace" && action != "update-endpoints") && *codeStdin) {
		writeText(c.stderr, gatewayMembershipHelp)
		return 2
	}
	code := ""
	if *address != "" {
		var err error
		code, err = c.readGatewayCode(*codeStdin)
		if err != nil {
			fmt.Fprintln(c.stderr, "Cannot read the invitation code. Use an owner terminal, or --code-stdin --yes for automation.")
			return 1
		}
	}
	layout, err := resolveBootstrapTargetLayout(*root)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	ctx := context.Background()
	_, err = runtimemanagement.LoadStatus(ctx, layout.RuntimeControlSocketPath, 2*time.Second)
	if err == nil {
		return c.gatewayRunningCommand(ctx, layout.RuntimeControlSocketPath, action, *address, code, "", *gatewayID, *yes)
	}
	if err := os.MkdirAll(layout.StateDir, 0700); err != nil {
		fmt.Fprintln(c.stderr, "Cannot open Runtime state.")
		return 1
	}
	lock, err := lockfile.Acquire(filepath.Join(layout.StateDir, "agent.lock"))
	if err != nil {
		fmt.Fprintln(c.stderr, "Runtime management is unavailable. Retry when startup completes.")
		return 1
	}
	defer func() { _ = lock.Release() }()
	cfg, err := config.Load(layout.ConfigPath)
	if errors.Is(err, os.ErrNotExist) {
		policy, _ := config.ParsePermissionPolicyPreset("")
		cfg = &config.Config{PermissionPolicy: policy, LogFormat: "json", LogLevel: "info"}
	} else if err != nil {
		fmt.Fprintln(c.stderr, "Cannot load Runtime configuration.")
		return 1
	}
	persist := func(member *gatewaymembership.RuntimeConfig) error {
		next := *cfg
		id := *gatewayID
		if member != nil {
			id = member.GatewayID
		} else if current := cfg.GatewayMember(id); current != nil {
			id = current.GatewayID
		}
		next.SetGatewayMember(id, member)
		if err := config.Save(layout.ConfigPath, &next); err != nil {
			return err
		}
		*cfg = next
		return nil
	}
	var invitation gp.EnrollmentDescriptor
	if *address != "" {
		invitation, err = gatewaymembership.PreviewInvitation(ctx, *address, code)
		if err != nil {
			fmt.Fprintln(c.stderr, "Gateway verification failed:", err)
			return 1
		}
		_, err = c.confirmGatewayEnrollment(invitation.GatewayName, cfg.LocalEnvironmentPublicID, invitation.ExpiresAtUnixMS, "", action, "", *yes)
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
	}
	if action == "join" || action == "replace" {
		hostname, _ := os.Hostname()
		prepare := cfg.PrepareGatewayJoin
		if action == "replace" {
			prepare = cfg.PrepareGatewayReplacement
		}
		next, err := prepare(invitation, gp.MemberMetadata{Hostname: hostname, OS: runtime.GOOS, Arch: runtime.GOARCH, Version: Version}, "")
		if err != nil {
			fmt.Fprintln(c.stderr, err.Error())
			return 1
		}
		if err := config.Save(layout.ConfigPath, next); err != nil {
			fmt.Fprintln(c.stderr, "Cannot save Gateway membership consent.")
			return 1
		}
		cfg = next
	}
	if action == "update-endpoints" {
		current := cfg.GatewayMember(invitation.GatewayID)
		if current == nil {
			fmt.Fprintln(c.stderr, "Select an invitation from a paired Gateway.")
			return 1
		}
		next, err := current.PrepareConnectionEndpoints(invitation)
		if err == nil {
			err = persist(next)
		}
		if err != nil {
			fmt.Fprintln(c.stderr, "Cannot verify the Gateway connection endpoints. Use a fresh invitation from the same Gateway identity.")
			return 1
		}
	}
	id := *gatewayID
	if invitation.GatewayID != "" {
		id = invitation.GatewayID
	}
	member := cfg.GatewayMember(id).Clone()
	if member != nil {
		*gatewayID = member.GatewayID
	}
	if action != "status" && member == nil {
		fmt.Fprintln(c.stderr, "Select --gateway-id when multiple Gateways are paired.")
		return 1
	}
	if action == "publish" {
		var association gp.MemberCloudContext
		err := member.Request(ctx, "/v6/member/cloud", gp.CatalogRequest{ProtocolVersion: gp.Version}, &association, true)
		if err != nil {
			fmt.Fprintln(c.stderr, "Cannot verify Gateway batch enrollment; retry or select another route.")
			return 1
		}
		next, err := cfg.PrepareNamespaceCloud(member.MemberID, association)
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		if !*yes && !c.confirmGatewayAction("Publish this Runtime to Redeven Cloud through "+member.GatewayID+"?") {
			return 1
		}
		if err := config.Save(layout.ConfigPath, next); err != nil {
			fmt.Fprintln(c.stderr, "Cannot save Cloud publication.")
			return 1
		}
		cfg = next
	}
	if action == "leave" && member != nil {
		impact := "Cancel pairing with " + member.GatewayID + "?"
		if cfg.CloudGateway() != nil && cfg.CloudGateway().MemberID == member.MemberID {
			impact += " Cloud access through this Gateway will be interrupted."
		}
		if !*yes && !c.confirmGatewayAction(impact) {
			return 1
		}
		member.Leaving = true
		if err := persist(member); err != nil {
			fmt.Fprintln(c.stderr, "Cannot save Gateway removal.")
			return 1
		}
	}
	if action != "status" && member != nil {
		if member.Leaving {
			err = member.Leave(ctx)
			if err == nil {
				err = persist(nil)
			}
		} else {
			err = member.Enroll(ctx, persist)
		}
		if err != nil {
			fmt.Fprintln(c.stderr, "Gateway delivery is pending. The saved configuration is retained; use gateway retry or start the Runtime.")
			return 1
		}
	}
	result := agent.GatewayMembershipStatus{Phase: "not_joined", ExistingEnvironmentID: cfg.EnvironmentID}
	for _, member := range cfg.Gateways {
		item := agent.GatewayMembershipStatus{Joined: member.PendingJoin == nil && !member.Leaving, GatewayID: member.GatewayID, GatewayName: member.GatewayName, RouteSelected: cfg.CloudGateway() != nil && cfg.CloudGateway().MemberID == member.MemberID, Endpoints: member.ConnectionEndpoints(), LastEndpointID: member.LastEndpointID, MemberID: member.MemberID, Phase: "gateway_offline"}
		if member.PendingJoin != nil {
			item.Phase = "joining"
		}
		if member.Leaving {
			item.Phase = "removal_pending"
		}
		result.Memberships = append(result.Memberships, item)
	}
	if len(result.Memberships) > 0 {
		result.Joined = true
		result.Phase = "joined"
	}
	_ = json.NewEncoder(c.stdout).Encode(result)
	return 0
}

func (c *cli) readGatewayCode(fromStdin bool) (string, error) {
	if fromStdin {
		raw, err := io.ReadAll(io.LimitReader(c.stdin, 129))
		if err != nil || len(raw) > 128 {
			return "", gatewaymembership.ErrInvitationInvalid
		}
		return string(raw), nil
	}
	tty, err := openTTYForPasswordPrompt()
	if err != nil {
		return "", err
	}
	if tty.shouldClose {
		defer tty.file.Close()
	}
	fmt.Fprint(tty.file, "One-time Gateway invitation code: ")
	raw, err := term.ReadPassword(int(tty.file.Fd()))
	fmt.Fprintln(tty.file)
	return string(raw), err
}

func (c *cli) confirmGatewayEnrollment(name, target string, expires int64, environment, action, choice string, yes bool) (string, error) {
	fmt.Fprintf(c.stdout, "Gateway: %s\nTarget Runtime: %s\nExpires: %s\n", name, target, time.UnixMilli(expires).Format(time.RFC3339))
	switch action {
	case "update-endpoints":
		fmt.Fprintln(c.stdout, "Update this Gateway's endpoints while preserving member identity.")
	case "replace":
		fmt.Fprintln(c.stdout, "Replace the current Gateway and interrupt its connections, including any Cloud access through it. Cloud publication requires a separate gateway publish action.")
	default:
		fmt.Fprintln(c.stdout, "Add Gateway access. Cloud ownership and other Gateway pairings stay unchanged.")
	}
	if yes {
		return choice, nil
	}
	tty, err := openTTYForPasswordPrompt()
	if err != nil {
		return "", err
	}
	if tty.shouldClose {
		defer tty.file.Close()
	}
	reader := bufio.NewReader(tty.file)
	fmt.Fprint(tty.file, "Confirm and enable? [y/N]: ")
	answer, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(strings.TrimSpace(answer), "y") {
		return "", errors.New("gateway enrollment canceled")
	}
	if expires <= time.Now().UnixMilli() {
		return "", gatewaymembership.ErrInvitationExpired
	}
	return choice, nil
}

func (c *cli) gatewayRunningCommand(ctx context.Context, socketPath, action, address, code, choice, gatewayID string, yes bool) int {
	var body any = struct{}{}
	if action == "retry" || action == "leave" || action == "publish" {
		var status agent.GatewayMembershipStatus
		if err := gatewayRuntimeRequest(ctx, socketPath, "status", struct{}{}, &status); err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		var target *agent.GatewayMembershipStatus
		for i := range status.Memberships {
			if status.Memberships[i].GatewayID == gatewayID || gatewayID == "" && len(status.Memberships) == 1 {
				target = &status.Memberships[i]
			}
		}
		if target == nil {
			fmt.Fprintln(c.stderr, "Select --gateway-id from gateway status.")
			return 1
		}
		if action != "retry" && !yes {
			impact := "Confirm " + action + " for " + target.GatewayID + "?"
			if action == "leave" && target.RouteSelected {
				impact += " Cloud access through this Gateway will be interrupted."
			}
			if !c.confirmGatewayAction(impact) {
				return 1
			}
		}
		body = map[string]any{"gateway_id": target.GatewayID}
		if action == "leave" {
			body.(map[string]any)["route_impact_acknowledged"] = target.RouteSelected
		}
	}
	if address != "" {
		var preview agent.GatewayPreview
		if err := gatewayRuntimeRequest(ctx, socketPath, "preview", map[string]string{"address": address, "code": code, "purpose": action}, &preview); err != nil {
			fmt.Fprintln(c.stderr, "Gateway verification failed:", err)
			return 1
		}
		var err error
		_, err = c.confirmGatewayEnrollment(preview.GatewayName, preview.TargetRuntimeID, preview.ExpiresAtUnixMS, "", action, choice, yes)
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		body = struct {
			PreviewID string `json:"preview_id"`
		}{preview.PreviewID}
	}
	var status agent.GatewayMembershipStatus
	if err := gatewayRuntimeRequest(ctx, socketPath, action, body, &status); err != nil {
		fmt.Fprintln(c.stderr, "Gateway operation failed:", err)
		return 1
	}
	_ = json.NewEncoder(c.stdout).Encode(status)
	return 0
}

func gatewayRuntimeRequest(ctx context.Context, socketPath, action string, body, output any) error {
	method := http.MethodPost
	if action == "status" {
		method = http.MethodGet
	}
	return ownerRuntimeRequest(ctx, socketPath, method, "/v2/gateway/"+action, body, output)
}

func ownerRuntimeRequest(ctx context.Context, socketPath, method, path string, body, output any) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://127.0.0.1:1"+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	request.Header.Set("X-Redeven-Runtime-Control-Protocol", "redeven-runtime-control-v2")
	request.Header.Set("Content-Type", "application/json")
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socketPath)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("runtime management is unavailable")
	}
	defer response.Body.Close()
	var envelope struct {
		OK    bool            `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&envelope) != nil {
		return errors.New("invalid Runtime management response")
	}
	if response.StatusCode != http.StatusOK || !envelope.OK {
		return errors.New("Runtime rejected the management operation: " + envelope.Error.Code)
	}
	return json.Unmarshal(envelope.Data, output)
}

func (c *cli) confirmGatewayAction(message string) bool {
	fmt.Fprintln(c.stdout, message)
	tty, err := openTTYForPasswordPrompt()
	if err != nil {
		fmt.Fprintln(c.stderr, "Use --yes to confirm this operation in automation.")
		return false
	}
	if tty.shouldClose {
		defer tty.file.Close()
	}
	fmt.Fprint(tty.file, "Confirm? [y/N]: ")
	answer, err := bufio.NewReader(tty.file).ReadString('\n')
	return err == nil && strings.EqualFold(strings.TrimSpace(answer), "y")
}
