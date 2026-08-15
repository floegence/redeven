package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/redevpluginintegration"
	"github.com/floegence/redevplugin/v2/pkg/ownerscope"
)

const pluginStateRecoverySchemaVersion = "redeven.plugin_state_recovery.v1"

type pluginStateRecoveryReport struct {
	SchemaVersion     string                                         `json:"schema_version"`
	Operation         string                                         `json:"operation"`
	Status            string                                         `json:"status"`
	Code              string                                         `json:"code"`
	Message           string                                         `json:"message,omitempty"`
	Plan              *redevpluginintegration.OwnerScopeRecoveryPlan `json:"plan,omitempty"`
	RecoveryID        string                                         `json:"recovery_id,omitempty"`
	FreshGenerationID string                                         `json:"fresh_generation_id,omitempty"`
}

func (c *cli) pluginStateRecoveryCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, pluginStateRecoveryHelpText())
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "inspect":
		return c.pluginStateRecoveryInspectCmd(args[1:])
	case "recover":
		return c.pluginStateRecoveryRecoverCmd(args[1:])
	default:
		writePluginStateRecoveryReport(c.stderr, pluginStateRecoveryReport{
			Operation: "unknown",
			Status:    "failed",
			Code:      "invalid_operation",
			Message:   "plugin-state-recovery requires inspect or recover",
		})
		return 2
	}
}

func (c *cli) pluginStateRecoveryInspectCmd(args []string) int {
	fs := newCLIFlagSet("plugin-state-recovery inspect")
	stateRoot := fs.String("state-root", "", "Exact Redeven state root")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, pluginStateRecoveryHelpText())
			return 0
		}
		return writePluginStateRecoveryUsageError(c.stderr, "inspect", err)
	}
	layout, ok := resolvePluginStateRecoveryLayout(c.stderr, "inspect", *stateRoot)
	if !ok {
		return 2
	}
	return withPluginStateRecoveryLock(c.stdout, layout, "inspect", func() pluginStateRecoveryReport {
		plan, err := redevpluginintegration.InspectOwnerScopeRecovery(layout.StateDir)
		if err != nil {
			return pluginStateRecoveryFailure("inspect", err)
		}
		return pluginStateRecoveryReport{
			Operation: "inspect",
			Status:    "recovery_required",
			Code:      "plugin_state_recovery_required",
			Plan:      &plan,
		}
	})
}

func (c *cli) pluginStateRecoveryRecoverCmd(args []string) int {
	fs := newCLIFlagSet("plugin-state-recovery recover")
	stateRoot := fs.String("state-root", "", "Exact Redeven state root")
	expectedPlanSHA256 := fs.String("expected-plan-sha256", "", "Digest from the reviewed recovery plan")
	confirmed := fs.Bool("confirm-retain-archive-and-reset-active-state", false, "Confirm retained archive and a fresh empty active generation")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, pluginStateRecoveryHelpText())
			return 0
		}
		return writePluginStateRecoveryUsageError(c.stderr, "recover", err)
	}
	if !*confirmed {
		writePluginStateRecoveryReport(c.stderr, pluginStateRecoveryReport{
			Operation: "recover",
			Status:    "failed",
			Code:      "confirmation_required",
			Message:   "explicit retained-archive and fresh-generation confirmation is required",
		})
		return 2
	}
	layout, ok := resolvePluginStateRecoveryLayout(c.stderr, "recover", *stateRoot)
	if !ok {
		return 2
	}
	return withPluginStateRecoveryLock(c.stdout, layout, "recover", func() pluginStateRecoveryReport {
		result, err := redevpluginintegration.RecoverOwnerScope(context.Background(), layout.StateDir, strings.TrimSpace(*expectedPlanSHA256))
		if err != nil {
			return pluginStateRecoveryFailure("recover", err)
		}
		return pluginStateRecoveryReport{
			Operation:         "recover",
			Status:            "recovered",
			Code:              "plugin_state_recovered",
			Plan:              &result.Plan,
			RecoveryID:        result.RecoveryID,
			FreshGenerationID: result.FreshGenerationID,
		}
	})
}

func resolvePluginStateRecoveryLayout(output interface{ Write([]byte) (int, error) }, operation, stateRoot string) (config.StateLayout, bool) {
	stateRoot = strings.TrimSpace(stateRoot)
	if stateRoot == "" {
		writePluginStateRecoveryReport(output, pluginStateRecoveryReport{
			Operation: operation,
			Status:    "failed",
			Code:      "state_root_required",
			Message:   "--state-root is required",
		})
		return config.StateLayout{}, false
	}
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		writePluginStateRecoveryReport(output, pluginStateRecoveryReport{
			Operation: operation,
			Status:    "failed",
			Code:      "state_root_invalid",
			Message:   "state root could not be resolved",
		})
		return config.StateLayout{}, false
	}
	return layout, true
}

func withPluginStateRecoveryLock(output interface{ Write([]byte) (int, error) }, layout config.StateLayout, operation string, run func() pluginStateRecoveryReport) int {
	if err := os.MkdirAll(layout.StateDir, 0o700); err != nil {
		writePluginStateRecoveryReport(output, pluginStateRecoveryFailure(operation, err))
		return 1
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		writePluginStateRecoveryReport(output, pluginStateRecoveryFailure(operation, err))
		return 1
	}
	defer func() { _ = lock.Release() }()
	report := run()
	writePluginStateRecoveryReport(output, report)
	if report.Status == "failed" {
		return 1
	}
	return 0
}

func writePluginStateRecoveryUsageError(output interface{ Write([]byte) (int, error) }, operation string, err error) int {
	writePluginStateRecoveryReport(output, pluginStateRecoveryReport{
		Operation: operation,
		Status:    "failed",
		Code:      "invalid_arguments",
		Message:   err.Error(),
	})
	return 2
}

func writePluginStateRecoveryReport(output interface{ Write([]byte) (int, error) }, report pluginStateRecoveryReport) {
	report.SchemaVersion = pluginStateRecoverySchemaVersion
	body, err := json.Marshal(report)
	if err != nil {
		_, _ = fmt.Fprintf(output, `{"schema_version":%q,"operation":%q,"status":"failed","code":"report_encoding_failed"}`+"\n", pluginStateRecoverySchemaVersion, report.Operation)
		return
	}
	_, _ = output.Write(append(body, '\n'))
}

func pluginStateRecoveryFailure(operation string, err error) pluginStateRecoveryReport {
	code := "plugin_state_recovery_failed"
	message := "Plugin state recovery did not complete."
	switch {
	case errors.Is(err, lockfile.ErrAlreadyLocked):
		code = "runtime_active"
		message = "Stop the runtime using this Local Environment before reviewing or recovering plugin state."
	case errors.Is(err, ownerscope.ErrOwnerScopeRecoveryPlanMismatch):
		code = "recovery_plan_changed"
		message = "The plugin state changed. Review the new recovery plan before continuing."
	case errors.Is(err, ownerscope.ErrOwnerScopeRecoveryNotEligible):
		code = "recovery_not_available"
		message = "This plugin state does not have an eligible retained-archive recovery plan."
	case errors.Is(err, ownerscope.ErrOwnerScopeJournalCorrupt):
		code = "plugin_state_journal_corrupt"
		message = "The plugin state migration journal is corrupt and no safe recovery plan is available."
	case errors.Is(err, ownerscope.ErrOwnerScopeSnapshotChanged):
		code = "plugin_state_changed"
		message = "The plugin state changed while recovery was being prepared. Review it again before continuing."
	case errors.Is(err, ownerscope.ErrOwnerScopeUnsupported):
		code = "recovery_unsupported"
		message = "This plugin state cannot be recovered by the installed Redeven version."
	}
	return pluginStateRecoveryReport{
		Operation: operation,
		Status:    "failed",
		Code:      code,
		Message:   message,
	}
}
