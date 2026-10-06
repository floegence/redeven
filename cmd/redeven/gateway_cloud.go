package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/lockfile"
)

const gatewayJoinHelp = `Usage: redeven gateway-join --material-file PATH [--state-root PATH]

Consent locally to join a Gateway and publish this runtime in Redeven Cloud.
The material identifies the Cloud, Namespace, Gateway and trusted TLS root.
This command waits for a Namespace administrator to approve publication.
Interrupted enrollment can be resumed with the same material and state root.
Stop the runtime before changing its connection configuration.
`

func (c *cli) gatewayJoinCmd(args []string) int    { return c.gatewayEnrollmentCmd(args, false, false) }
func (c *cli) gatewayMigrateCmd(args []string) int { return c.gatewayEnrollmentCmd(args, true, false) }
func (c *cli) gatewayReauthorizeCmd(args []string) int {
	return c.gatewayEnrollmentCmd(args, true, true)
}
func (c *cli) gatewayEnrollmentCmd(args []string, migrate, reauthorize bool) int {
	command, help := "gateway-join", gatewayJoinHelp
	if migrate {
		command, help = "gateway-migrate", gatewayMigrateHelp
	}
	if reauthorize {
		command, help = "gateway-reauthorize", gatewayReauthorizeHelp
	}
	fs := newCLIFlagSet(command)
	materialFile := fs.String("material-file", "", "Private Gateway join material file")
	stateRoot := fs.String("state-root", "", "Runtime state root")
	newEnvironment := fs.Bool("new-environment", false, "Create a new Cloud environment without claiming the previous identity (gateway-reauthorize only)")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, help)
			return 0
		}
		writeText(c.stderr, help)
		return 2
	}
	if *materialFile == "" || (*newEnvironment && !reauthorize) {
		writeText(c.stderr, help)
		return 2
	}
	layout, err := resolveBootstrapTargetLayout(*stateRoot)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	if err := os.MkdirAll(layout.StateDir, 0700); err != nil {
		fmt.Fprintln(c.stderr, "Cannot open runtime state directory.")
		return 1
	}
	lock, err := lockfile.Acquire(filepath.Join(layout.StateDir, "agent.lock"))
	if err != nil {
		fmt.Fprintln(c.stderr, "Stop this runtime before configuring Gateway Cloud access.")
		return 1
	}
	defer func() { _ = lock.Release() }()
	file, err := os.Open(*materialFile)
	if err != nil {
		fmt.Fprintln(c.stderr, "Cannot read join material.")
		return 1
	}
	defer file.Close()
	var material gc.JoinMaterial
	dec := json.NewDecoder(io.LimitReader(file, 64<<10))
	dec.DisallowUnknownFields()
	if dec.Decode(&material) != nil || dec.Decode(new(any)) != io.EOF {
		fmt.Fprintln(c.stderr, "Invalid join material.")
		return 1
	}
	cfg, err := config.Load(layout.ConfigPath)
	if errors.Is(err, os.ErrNotExist) {
		cfg = &config.Config{}
	} else if err != nil {
		fmt.Fprintln(c.stderr, "Cannot load runtime configuration.")
		return 1
	}
	oldPath := cfg.GatewayCloud
	if migrate {
		if cfg.EnvironmentID == "" || (reauthorize && oldPath == nil) || (oldPath != nil && ((!*newEnvironment && oldPath.Binding == nil) || (!reauthorize && oldPath.Revoked))) {
			fmt.Fprintln(c.stderr, "This operation requires the existing binding identity; revoked access needs gateway-reauthorize.")
			return 1
		}
		if cfg.GatewayCloudMigration == nil {
			target, prepareErr := gatewaycloud.PrepareRuntime(material, cfg.LocalEnvironmentPublicID)
			if prepareErr != nil || target.CloudOrigin != cfg.ProviderOrigin || target.RegionOrigin != cfg.ControlplaneBaseURL || (oldPath != nil && (target.NamespacePublicID != oldPath.NamespacePublicID || (!reauthorize && target.GatewayPublicID == oldPath.GatewayPublicID))) {
				fmt.Fprintln(c.stderr, "The destination must match the Cloud, Namespace and Region; migration also requires a different Gateway.")
				return 1
			}
			target.NewEnvironment = *newEnvironment
			cfg.GatewayCloudMigration = target
			if config.Save(layout.ConfigPath, cfg) != nil {
				return 1
			}
		}
		if cfg.GatewayCloudMigration.RequestPublicID != material.RequestPublicID || cfg.GatewayCloudMigration.NewEnvironment != *newEnvironment {
			fmt.Fprintln(c.stderr, "Another migration is already pending. Resume with its original join material.")
			return 1
		}
	} else if cfg.GatewayCloud == nil {
		if cfg.EnvironmentID != "" {
			fmt.Fprintln(c.stderr, "This runtime is already bound. Use an explicit Cloud migration to preserve its environment.")
			return 1
		}
		if cfg.EnsureRuntimeIDs() != nil {
			fmt.Fprintln(c.stderr, "Cannot create local runtime identity.")
			return 1
		}
		cfg.GatewayCloud, err = gatewaycloud.PrepareRuntime(material, cfg.LocalEnvironmentPublicID)
		if err != nil {
			fmt.Fprintln(c.stderr, "Join material is invalid or expired.")
			return 1
		}
		if err = config.Save(layout.ConfigPath, cfg); err != nil {
			fmt.Fprintln(c.stderr, "Cannot save local consent.")
			return 1
		}
	} else if cfg.GatewayCloud.RequestPublicID != material.RequestPublicID || cfg.GatewayCloud.CloudOrigin != material.CloudOrigin || cfg.GatewayCloud.GatewayPublicID != material.GatewayPublicID {
		fmt.Fprintln(c.stderr, "A different Gateway path is already configured. Use explicit migration.")
		return 1
	}
	r := cfg.GatewayCloud
	if migrate {
		r = cfg.GatewayCloudMigration
	}
	if *newEnvironment {
		fmt.Fprintln(c.stdout, "This creates a new Cloud environment. An administrator must remove the old membership first. The old environment and audit history are not merged. Local files and settings are preserved.")
	}
	fmt.Fprintf(c.stdout, "Cloud: %s\nNamespace: %s\nGateway: %s\n", r.CloudOrigin, r.NamespacePublicID, r.GatewayURL)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if r.ClientCertificatePEM == "" {
		if err = r.Enroll(ctx); err != nil {
			fmt.Fprintln(c.stderr, "Gateway enrollment failed. Check its connection and retry the same command.")
			return 1
		}
		if config.Save(layout.ConfigPath, cfg) != nil {
			return 1
		}
	}
	if r.JoinToken != "" {
		hostname, _ := os.Hostname()
		if _, err = r.Join(ctx, gc.RuntimeMetadata{Hostname: hostname, OS: runtime.GOOS, Arch: runtime.GOARCH, Version: Version}); err != nil {
			fmt.Fprintln(c.stderr, "Cloud proof was not accepted. Retry with the same join material.")
			return 1
		}
	}
	if migrate && !*newEnvironment {
		status, statusErr := r.Status(ctx)
		if statusErr != nil {
			fmt.Fprintln(c.stderr, "Cannot read migration status. Retry the same command.")
			return 1
		}
		if status.Candidate.Binding == nil && status.Candidate.UserMigrationSource == nil && status.Candidate.MigrationSource == nil {
			var consentErr error
			if oldPath == nil {
				fmt.Fprintln(c.stdout, "This changes Cloud access ownership from a user to the Namespace. Cloud approval is required.")
				cfg, consentErr = agent.ConsentGatewayUserMigration(ctx, layout.ConfigPath, layout.StateDir, cfg, r)
			} else if reauthorize {
				consentErr = oldPath.ConsentReauthorization(ctx, r)
			} else {
				consentErr = oldPath.ConsentMigration(ctx, r)
			}
			if consentErr != nil {
				fmt.Fprintln(c.stderr, "Migration consent was not accepted. Retry the same command.")
				return 1
			}
		}
	}
	fmt.Fprintf(c.stdout, "Waiting for publication: %s\n", gatewaycloud.GatewayManagementURL(r.CloudOrigin, r.NamespacePublicID, r.GatewayPublicID, ""))
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		status, err := r.Status(ctx)
		if err == nil {
			if status.Candidate.State == "revoked" {
				fmt.Fprintln(c.stderr, "Cloud access was revoked. New authorization is required.")
				return 1
			}
			if b := status.Candidate.Binding; b != nil && b.State == "active" {
				if b.GatewayPublicID != r.GatewayPublicID || b.NamespacePublicID != r.NamespacePublicID || b.RuntimePublicID != r.RuntimePublicID {
					fmt.Fprintln(c.stderr, "Cloud binding does not match local consent.")
					return 1
				}
				r.Binding = b
				if r.DeliveryRequestID == "" {
					r.DeliveryRequestID, err = gatewaycloud.NewDeliveryID()
					if err != nil {
						return 1
					}
				}
				if config.Save(layout.ConfigPath, cfg) != nil {
					return 1
				}
				delivery, err := r.Recover(ctx)
				if r.ForgetExpiredDelivery(err) {
					if config.Save(layout.ConfigPath, cfg) != nil {
						return 1
					}
				}
				if err == nil {
					if migrate {
						if oldPath != nil && !*newEnvironment {
							previous := *oldPath
							previous.PreviousPath = nil
							r.PreviousPath = &previous
						}
						cfg.GatewayCloud = r
						cfg.GatewayCloudMigration = nil
					}
					if err = cfg.ApplyGatewayDelivery(delivery); err != nil {
						fmt.Fprintln(c.stderr, "Credential delivery validation failed.")
						return 1
					}
					if config.Save(layout.ConfigPath, cfg) != nil {
						return 1
					}
					if migrate {
						_ = cfg.GatewayCloud.AcknowledgePreviousPath(ctx)
					}
					fmt.Fprintf(c.stdout, "Configured environment: %s\n", cfg.EnvironmentID)
					if *stateRoot == "" {
						fmt.Fprintln(c.stdout, "Start with: redeven run")
					} else {
						fmt.Fprintf(c.stdout, "Start with: redeven run --state-root %q\n", *stateRoot)
					}
					return 0
				}
			}
		}
		select {
		case <-ctx.Done():
			fmt.Fprintln(c.stdout, "Enrollment saved. Run the same command to resume.")
			return 130
		case <-ticker.C:
		}
	}
}

const gatewayMigrateHelp = `Usage: redeven gateway-migrate --material-file PATH [--state-root PATH]

Move this Runtime's Cloud binding to a Gateway in the same Namespace
and Region. Stop the Runtime first; existing sessions may be interrupted.
Download join material from the destination Gateway in Cloud. This command
records local consent and waits for a Namespace administrator to approve.
The environment ID is preserved. A user-owned binding becomes Namespace-owned
only after its current control identity and Cloud administrator approval succeed.
Interrupted migration resumes with the same file.
`

const gatewayReauthorizeHelp = `Usage: redeven gateway-reauthorize --material-file PATH [--state-root PATH]

Authorize a new membership after the previous Cloud access was revoked.
Stop the Runtime first and obtain new join material from an approved Gateway
in the same Namespace and Region. Local consent and Cloud administrator
approval are both required. A valid original binding identity preserves the
environment ID; an expired or lost identity cannot claim the old environment.
If the old identity is lost or expired, use --new-environment after an
administrator removes the old membership. This creates a new Cloud environment
and keeps local files and settings. It never claims or merges the old environment.
Resume an interrupted operation with the same material and command.
`

const gatewayAddressHelp = `Usage: redeven gateway-address --gateway-url HTTPS_ORIGIN [--state-root PATH]

Change only the internal address of the same Gateway. Stop this Runtime first.
The existing Gateway TLS trust, membership identity and Cloud binding are checked
through the new address before it is saved. A different Gateway requires migration.
`

func (c *cli) gatewayAddressCmd(args []string) int {
	fs := newCLIFlagSet("gateway-address")
	address := fs.String("gateway-url", "", "New HTTPS origin of the same Gateway")
	stateRoot := fs.String("state-root", "", "Runtime state root")
	if err := parseCommandFlags(fs, args); err != nil || !gc.ValidOrigin(*address) {
		writeText(c.stderr, gatewayAddressHelp)
		return 2
	}
	layout, err := resolveBootstrapTargetLayout(*stateRoot)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	lock, err := lockfile.Acquire(filepath.Join(layout.StateDir, "agent.lock"))
	if err != nil {
		fmt.Fprintln(c.stderr, "Stop this Runtime before changing the Gateway address.")
		return 1
	}
	defer func() { _ = lock.Release() }()
	cfg, err := config.Load(layout.ConfigPath)
	if err != nil || cfg.GatewayCloud == nil || cfg.GatewayCloudMigration != nil {
		fmt.Fprintln(c.stderr, "No stable Gateway membership is configured.")
		return 1
	}
	route := *cfg.GatewayCloud
	route.GatewayURL = *address
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	status, err := route.Status(ctx)
	if err != nil || status.Candidate.RequestPublicID != route.RequestPublicID || status.Candidate.RuntimePublicID != route.RuntimePublicID {
		fmt.Fprintln(c.stderr, "The new address could not verify this Gateway membership. The saved address is unchanged.")
		return 1
	}
	cfg.GatewayCloud = &route
	if config.Save(layout.ConfigPath, cfg) != nil {
		fmt.Fprintln(c.stderr, "Cannot save the verified Gateway address.")
		return 1
	}
	fmt.Fprintln(c.stdout, "Gateway address updated. Start the Runtime to reconnect.")
	return 0
}
