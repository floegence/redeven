package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"golang.org/x/term"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/lockfile"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

const gatewayMembershipHelp = `Usage: redeven gateway <join|replace|update-endpoints|status|retry|leave> [flags]

  --state-root PATH        Runtime state root
  --gateway ADDRESS       Administrator-confirmed HTTPS Gateway address
  --code-stdin --yes       Read the invitation code from stdin and confirm for automation
  --environment-choice preserve|new  Explicit choice for an existing Cloud environment

Joining delegates LAN access and later Cloud publication to this Gateway.
A Runtime belongs to one Gateway. Ordinary startup reconnects the saved member.
Cloud publication remains subject to Gateway policy and Namespace authorization.
Leave disables local access first and durably retries Gateway removal.
`

func (c *cli) gatewayCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, gatewayMembershipHelp)
		return 0
	}
	action := args[0]
	if action != "join" && action != "replace" && action != "update-endpoints" && action != "status" && action != "retry" && action != "leave" {
		writeText(c.stderr, gatewayMembershipHelp)
		return 2
	}
	flags := newCLIFlagSet("gateway " + action)
	root := flags.String("state-root", "", "Runtime state root")
	choice := flags.String("environment-choice", "", "Preserve the existing Cloud environment or create a new one")
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
	if (action != "join" && action != "replace" && *choice != "") || flags.NArg() != 0 || (action == "join" || action == "replace" || action == "update-endpoints") != (*address != "") || (*codeStdin && !*yes) || ((action != "join" && action != "replace" && action != "update-endpoints") && (*codeStdin || *yes)) {
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
		return c.gatewayRunningCommand(ctx, layout.RuntimeControlSocketPath, action, *address, code, *choice, *yes)
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
		next.Gateway = member.Clone()
		if member == nil || member.Leaving {
			if err := next.RetireGatewayPublication(); err != nil {
				return err
			}
		}
		if err := config.Save(layout.ConfigPath, &next); err != nil {
			return err
		}
		*cfg = next
		return nil
	}
	var invitation gp.EnrollmentDescriptor
	if *address != "" {
		invitation, err = gatewaymembership.PreviewInvitation(ctx, *address, code)
		code = ""
		if err != nil {
			fmt.Fprintln(c.stderr, "Gateway verification failed:", err)
			return 1
		}
		*choice, err = c.confirmGatewayEnrollment(invitation.GatewayName, cfg.LocalEnvironmentPublicID, invitation.ExpiresAtUnixMS, cfg.EnvironmentID, action, *choice, *yes)
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
		next, err := prepare(invitation, gp.MemberMetadata{Hostname: hostname, OS: runtime.GOOS, Arch: runtime.GOARCH, Version: Version}, *choice)
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
		next, err := cfg.Gateway.PrepareConnectionEndpoints(invitation)
		if err == nil {
			err = persist(next)
		}
		if err != nil {
			fmt.Fprintln(c.stderr, "Cannot verify the Gateway connection endpoints. Use a fresh invitation from the same Gateway identity.")
			return 1
		}
	}
	member := cfg.Gateway.Clone()
	if action == "leave" && member != nil {
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
	result := agent.GatewayMembershipStatus{Phase: "not_joined", ExistingEnvironmentID: cfg.EnvironmentID, RejoinRequired: cfg.GatewayRejoinRequired}
	if member := cfg.Gateway; member != nil {
		result = agent.GatewayMembershipStatus{Joined: member.PendingJoin == nil && !member.Leaving, GatewayID: member.GatewayID, Endpoints: member.ConnectionEndpoints(), LastEndpointID: member.LastEndpointID, MemberID: member.MemberID, Phase: "gateway_offline"}
		if member.PendingJoin != nil {
			result.Phase = "joining"
		}
		if member.Leaving {
			result.Phase = "removal_pending"
		}
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
	if action == "update-endpoints" {
		fmt.Fprintln(c.stdout, "Update this Gateway's endpoints while preserving member identity.")
	} else {
		fmt.Fprintln(c.stdout, "Enable Gateway-managed local access and later Cloud publication. Desktop access and Cloud approval remain separate.")
		if action == "replace" {
			fmt.Fprintln(c.stdout, "Replace the current Gateway and interrupt its connections.")
		}
	}
	if environment != "" && action != "update-endpoints" {
		fmt.Fprintf(c.stdout, "Existing Cloud environment: %s\nPreserve keeps its identity and permissions after Cloud approval; new creates a separate environment.\n", environment)
		if choice == "" && yes {
			return "", errors.New("choose --environment-choice preserve or new for the existing Cloud environment")
		}
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
	if environment != "" && action != "update-endpoints" && choice == "" {
		fmt.Fprint(tty.file, "Cloud environment [preserve/new]: ")
		answer, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		choice = strings.TrimSpace(answer)
		if choice != "preserve" && choice != "new" {
			return "", errors.New("choose preserve or new explicitly")
		}
	}
	fmt.Fprint(tty.file, "Confirm and enable? [y/N]: ")
	answer, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(strings.TrimSpace(answer), "y") {
		return "", errors.New("Gateway enrollment canceled")
	}
	if expires <= time.Now().UnixMilli() {
		return "", gatewaymembership.ErrInvitationExpired
	}
	return choice, nil
}

func (c *cli) gatewayRunningCommand(ctx context.Context, socketPath, action, address, code, choice string, yes bool) int {
	var body any = struct{}{}
	if address != "" {
		var preview agent.GatewayPreview
		if err := gatewayRuntimeRequest(ctx, socketPath, "preview", map[string]string{"address": address, "code": code, "purpose": action}, &preview); err != nil {
			fmt.Fprintln(c.stderr, "Gateway verification failed:", err)
			return 1
		}
		code = ""
		var err error
		choice, err = c.confirmGatewayEnrollment(preview.GatewayName, preview.TargetRuntimeID, preview.ExpiresAtUnixMS, preview.ExistingEnvironmentID, action, choice, yes)
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		body = struct {
			PreviewID         string `json:"preview_id"`
			EnvironmentChoice string `json:"environment_choice,omitempty"`
		}{preview.PreviewID, choice}
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
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	method := http.MethodPost
	if action == "status" {
		method = http.MethodGet
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://127.0.0.1:1/v2/gateway/"+action, bytes.NewReader(raw))
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
		return errors.New("Runtime management is unavailable")
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
		return errors.New("Runtime rejected the Gateway operation: " + envelope.Error.Code)
	}
	return json.Unmarshal(envelope.Data, output)
}
