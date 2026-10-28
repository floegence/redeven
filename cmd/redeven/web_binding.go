package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/webbinding"
)

const webBindingHelp = `Usage: redeven web-binding <list|apply|revoke> [flags]

  --state-root PATH      Runtime state root
  --stdin                Read an exact binding descriptor from standard input
  --id ID                Binding to revoke
  --revision NUMBER      Required current revision for revocation
  --yes                  Confirm consent changes for automation

Apply reads the descriptor generated for this Runtime by the Web Center.
Review its HTTPS origin and Connector public-key fingerprint before confirming.
The descriptor grants application access only; Runtime login remains required.
Revoke closes this binding's active requests and authentication sessions.
Running Runtimes use their owner-only socket. Stopped Runtimes require the
exclusive state lock. An application password cannot grant binding consent.
`

func (c *cli) webBindingCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, webBindingHelp)
		return 0
	}
	action := args[0]
	if action != "list" && action != "apply" && action != "revoke" {
		writeText(c.stderr, webBindingHelp)
		return 2
	}
	flags := newCLIFlagSet("web-binding " + action)
	root := flags.String("state-root", "", "Runtime state root")
	stdin := flags.Bool("stdin", false, "Read binding JSON from stdin")
	id := flags.String("id", "", "Binding identity")
	revision := flags.Int64("revision", 0, "Expected binding revision")
	yes := flags.Bool("yes", false, "Confirm binding changes")
	if err := parseCommandFlags(flags, args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, webBindingHelp)
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 || (action == "apply") != *stdin || (action == "revoke" && (*id == "" || *revision < 1)) || (action != "revoke" && (*id != "" || *revision != 0)) {
		writeText(c.stderr, webBindingHelp)
		return 2
	}
	var binding webbinding.Binding
	if action == "apply" {
		raw, err := io.ReadAll(io.LimitReader(c.stdin, 4097))
		if err != nil || len(raw) > 4096 {
			fmt.Fprintln(c.stderr, "Cannot read binding descriptor.")
			return 1
		}
		binding, err = webbinding.Decode(raw)
		if err != nil {
			fmt.Fprintln(c.stderr, "Invalid binding descriptor. Use an exact HTTPS origin, Runtime identity and Connector public-key fingerprint.")
			return 1
		}
	}
	layout, err := resolveBootstrapTargetLayout(*root)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	ctx := context.Background()
	_, statusErr := runtimemanagement.LoadStatus(ctx, layout.RuntimeControlSocketPath, 2*time.Second)
	var store *webbinding.Store
	var runtimeID string
	if statusErr != nil {
		lock, err := lockfile.Acquire(filepath.Join(layout.StateDir, "agent.lock"))
		if err != nil {
			fmt.Fprintln(c.stderr, "Runtime management is unavailable. Wait for startup or stop the Runtime before retrying.")
			return 1
		}
		defer lock.Release()
		cfg, err := config.Load(layout.ConfigPath)
		if err != nil || cfg.LocalEnvironmentPublicID == "" {
			fmt.Fprintln(c.stderr, "Initialize this Runtime before granting Web entry consent.")
			return 1
		}
		runtimeID = cfg.LocalEnvironmentPublicID
		store, err = webbinding.Open(layout.StateDir, runtimeID)
		if err != nil {
			fmt.Fprintln(c.stderr, "Cannot open Web entry consent:", err)
			return 1
		}
		defer store.Close()
	}
	list := func() ([]webbinding.Binding, error) {
		if store != nil {
			return store.List()
		}
		var rows []webbinding.Binding
		err := ownerRuntimeRequest(ctx, layout.RuntimeControlSocketPath, http.MethodGet, "/v2/runtime/web-bindings", nil, &rows)
		return rows, err
	}
	if action == "list" {
		rows, err := list()
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		return c.printWebBindings(rows)
	}
	if action == "revoke" {
		rows, err := list()
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		found := false
		for _, row := range rows {
			if row.ID == *id && row.Revision == *revision {
				binding = row
				binding.Enabled = false
				found = true
				break
			}
		}
		if !found {
			fmt.Fprintln(c.stderr, "Binding changed or was not found. List bindings and use the current revision.")
			return 1
		}
	}
	if runtimeID != "" && binding.RuntimeID != runtimeID {
		fmt.Fprintln(c.stderr, "The binding belongs to a different Runtime.")
		return 1
	}
	if !*yes && !c.confirmGatewayAction(fmt.Sprintf("%s Web entry %s for Runtime %s?\nOrigin: %s\nConnector SHA-256: %s\nExpected revision: %d", action, binding.ID, binding.RuntimeID, binding.Origin, binding.PublicKeySHA256, binding.Revision)) {
		return 1
	}
	var next webbinding.Binding
	if store != nil {
		next, err = store.Put(binding, binding.Revision)
	} else {
		err = ownerRuntimeRequest(ctx, layout.RuntimeControlSocketPath, http.MethodPut, "/v2/runtime/web-bindings", binding, &next)
	}
	if err != nil {
		fmt.Fprintln(c.stderr, "Web entry consent was not changed:", err)
		return 1
	}
	return c.printWebBindings(next)
}

func (c *cli) printWebBindings(value any) int {
	encoder := json.NewEncoder(c.stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		fmt.Fprintln(c.stderr, "Cannot write Web entry consent result.")
		return 1
	}
	return 0
}
