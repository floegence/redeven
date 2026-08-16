package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/localui"
	"github.com/floegence/redeven/internal/lockfile"
)

const localAuthorityReportSchemaVersion = "redeven.local_authority_maintenance.v1"

type localAuthorityReport struct {
	SchemaVersion   string `json:"schema_version"`
	Operation       string `json:"operation"`
	Status          string `json:"status"`
	Code            string `json:"code"`
	Message         string `json:"message,omitempty"`
	PreviousVersion int    `json:"previous_version,omitempty"`
	CurrentVersion  int    `json:"current_version,omitempty"`
	RetainedKeys    int    `json:"retained_keys,omitempty"`
}

func (c *cli) localAuthorityCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, localAuthorityHelpText())
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	if strings.TrimSpace(strings.ToLower(args[0])) != "rotate-key" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{
			Operation: "unknown",
			Status:    "failed",
			Code:      "invalid_operation",
			Message:   "local-authority requires rotate-key",
		})
		return 2
	}
	return c.localAuthorityRotateKeyCmd(args[1:])
}

func (c *cli) localAuthorityRotateKeyCmd(args []string) int {
	fs := newCLIFlagSet("local-authority rotate-key")
	stateRoot := fs.String("state-root", "", "Exact Redeven state root")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, localAuthorityHelpText())
			return 0
		}
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "rotate-key", Status: "failed", Code: "invalid_arguments", Message: err.Error()})
		return 2
	}
	if strings.TrimSpace(*stateRoot) == "" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "rotate-key", Status: "failed", Code: "state_root_required", Message: "--state-root is required"})
		return 2
	}
	layout, err := config.LocalEnvironmentStateLayout(*stateRoot)
	if err != nil {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "rotate-key", Status: "failed", Code: "state_root_invalid", Message: "state root could not be resolved"})
		return 2
	}
	if err := os.MkdirAll(layout.StateDir, 0o700); err != nil {
		writeLocalAuthorityReport(c.stderr, localAuthorityFailure(err))
		return 1
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		writeLocalAuthorityReport(c.stderr, localAuthorityFailure(err))
		return 1
	}
	defer func() { _ = lock.Release() }()
	result, err := localui.RotateLocalAuthorizationKey(layout.StateRoot)
	if err != nil {
		writeLocalAuthorityReport(c.stderr, localAuthorityFailure(err))
		return 1
	}
	writeLocalAuthorityReport(c.stdout, localAuthorityReport{
		Operation:       "rotate-key",
		Status:          "rotated",
		Code:            "local_authority_key_rotated",
		PreviousVersion: result.PreviousVersion,
		CurrentVersion:  result.CurrentVersion,
		RetainedKeys:    result.RetainedKeys,
	})
	return 0
}

func localAuthorityFailure(err error) localAuthorityReport {
	report := localAuthorityReport{Operation: "rotate-key", Status: "failed", Code: "local_authority_rotation_failed", Message: "Local authority key rotation did not complete."}
	if errors.Is(err, lockfile.ErrAlreadyLocked) {
		report.Code = "runtime_active"
		report.Message = "Stop the runtime using this Local Environment before rotating its local authority key."
	}
	return report
}

func writeLocalAuthorityReport(output interface{ Write([]byte) (int, error) }, report localAuthorityReport) {
	report.SchemaVersion = localAuthorityReportSchemaVersion
	body, err := json.Marshal(report)
	if err != nil {
		_, _ = fmt.Fprintf(output, `{"schema_version":%q,"operation":%q,"status":"failed","code":"report_encoding_failed"}`+"\n", localAuthorityReportSchemaVersion, report.Operation)
		return
	}
	_, _ = output.Write(append(body, '\n'))
}
