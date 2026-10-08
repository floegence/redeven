package main

import (
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
  --invitation-file PATH  Private invitation file (join, replace, or update-endpoints)
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
	file := flags.String("invitation-file", "", "Private Gateway invitation file")
	if err := parseCommandFlags(flags, args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, gatewayMembershipHelp)
			return 0
		}
		return 2
	}
	if (action != "join" && action != "replace" && *choice != "") || flags.NArg() != 0 || (action == "join" || action == "replace" || action == "update-endpoints") != (*file != "") {
		writeText(c.stderr, gatewayMembershipHelp)
		return 2
	}
	var invitation gp.MemberInvitation
	if action == "join" || action == "replace" || action == "update-endpoints" {
		if err := readGatewayInvitation(*file, &invitation); err != nil {
			fmt.Fprintln(c.stderr, "Cannot read a valid, unexpired Gateway invitation.")
			return 1
		}
	}
	layout, err := resolveBootstrapTargetLayout(*root)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err = runtimemanagement.LoadStatus(ctx, layout.RuntimeControlSocketPath, 2*time.Second)
	if err == nil {
		return c.gatewayRunningCommand(ctx, layout.RuntimeControlSocketPath, action, invitation, *choice)
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

func readGatewayInvitation(path string, invitation *gp.MemberInvitation) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(invitation) != nil || decoder.Decode(new(any)) != io.EOF {
		return gatewaymembership.ErrInvalidProof
	}
	return gatewaymembership.VerifyInvitation(*invitation, time.Now())
}

func (c *cli) gatewayRunningCommand(ctx context.Context, socketPath string, action string, invitation gp.MemberInvitation, choice string) int {
	method, body := http.MethodPost, []byte(`{}`)
	if action == "status" {
		method = http.MethodGet
	}
	if action == "join" || action == "replace" || action == "update-endpoints" {
		body, _ = json.Marshal(struct {
			Invitation        gp.MemberInvitation `json:"invitation"`
			EnvironmentChoice string              `json:"environment_choice,omitempty"`
		}{invitation, choice})
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://127.0.0.1:1/v2/gateway/"+action, bytes.NewReader(body))
	if err != nil {
		return 1
	}
	request.Header.Set("X-Redeven-Runtime-Control-Protocol", "redeven-runtime-control-v2")
	request.Header.Set("Content-Type", "application/json")
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return dialer.DialContext(ctx, "unix", socketPath)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		fmt.Fprintln(c.stderr, "Runtime management is unavailable.")
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		fmt.Fprintf(c.stderr, "Gateway operation failed (HTTP %d).\n", response.StatusCode)
		return 1
	}
	var envelope struct {
		OK   bool                          `json:"ok"`
		Data agent.GatewayMembershipStatus `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&envelope) != nil || !envelope.OK {
		fmt.Fprintln(c.stderr, "Invalid Runtime management response.")
		return 1
	}
	_ = json.NewEncoder(c.stdout).Encode(envelope.Data)
	return 0
}
