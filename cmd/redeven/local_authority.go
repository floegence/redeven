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
	Identity        string `json:"identity,omitempty"`
	Trust           string `json:"trust,omitempty"`
	NotAfter        string `json:"not_after,omitempty"`
	CertificatePath string `json:"certificate_path,omitempty"`
	OutputPath      string `json:"output_path,omitempty"`
}

func (c *cli) localAuthorityCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, localAuthorityHelpText())
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	operation := strings.TrimSpace(strings.ToLower(args[0]))
	if operation == "device-ca" {
		return c.localAuthorityDeviceCACmd(args[1:])
	}
	if operation != "rotate-key" {
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

func (c *cli) localAuthorityDeviceCACmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, localAuthorityHelpText())
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	operation := strings.TrimSpace(strings.ToLower(args[0]))
	if operation != "generate" && operation != "status" && operation != "export" && operation != "install" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca", Status: "failed", Code: "invalid_operation", Message: "device-ca requires generate, status, export, or install"})
		return 2
	}
	fs := newCLIFlagSet("local-authority device-ca " + operation)
	stateRoot := fs.String("state-root", "", "Exact Redeven state root")
	outputPath := fs.String("output", "", "New public CA certificate export path")
	scope := fs.String("scope", "user", "Trust scope; only user is supported")
	if err := parseCommandFlags(fs, args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, localAuthorityHelpText())
			return 0
		}
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-" + operation, Status: "failed", Code: "invalid_arguments", Message: err.Error()})
		return 2
	}
	if strings.TrimSpace(*stateRoot) == "" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-" + operation, Status: "failed", Code: "state_root_required", Message: "--state-root is required"})
		return 2
	}
	if operation != "export" && strings.TrimSpace(*outputPath) != "" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-" + operation, Status: "failed", Code: "invalid_arguments", Message: "--output is valid only for device-ca export"})
		return 2
	}
	if operation != "install" && strings.TrimSpace(*scope) != "user" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-" + operation, Status: "failed", Code: "invalid_arguments", Message: "--scope is valid only for device-ca install"})
		return 2
	}
	if operation == "install" && strings.TrimSpace(strings.ToLower(*scope)) != "user" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-install", Status: "failed", Code: "unsupported_scope", Message: "only current-user trust installation is supported"})
		return 2
	}
	layout, err := config.LocalEnvironmentStateLayout(*stateRoot)
	if err != nil {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-" + operation, Status: "failed", Code: "state_root_invalid", Message: "state root could not be resolved"})
		return 2
	}

	switch operation {
	case "status":
		status, statusErr := localui.InspectLocalUIDeviceCA(layout.StateDir)
		report := deviceCAReport(operation, status)
		if statusErr != nil {
			report.Status = "failed"
			report.Code = deviceCAErrorCode(statusErr)
			report.Message = status.Remedy
			writeLocalAuthorityReport(c.stderr, report)
			return 1
		}
		if status.Trust == "manual_required" {
			report.Status = "manual_required"
			report.Code = "local_ui_device_ca_manual_install_required"
			report.Message = status.Remedy
		}
		writeLocalAuthorityReport(c.stdout, report)
		return 0
	case "export":
		if strings.TrimSpace(*outputPath) == "" {
			writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-export", Status: "failed", Code: "output_required", Message: "--output is required"})
			return 2
		}
		if err := localui.ExportLocalUIDeviceCA(layout.StateDir, *outputPath); err != nil {
			writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-export", Status: "failed", Code: deviceCAErrorCode(err), Message: "Public CA certificate export did not complete."})
			return 1
		}
		writeLocalAuthorityReport(c.stdout, localAuthorityReport{Operation: "device-ca-export", Status: "exported", Code: "local_ui_device_ca_exported", OutputPath: strings.TrimSpace(*outputPath)})
		return 0
	case "install":
		if err := localui.InstallLocalUIDeviceCAForCurrentUser(layout.StateDir); err != nil {
			report := localAuthorityReport{Operation: "device-ca-install", Status: "failed", Code: deviceCAErrorCode(err), CertificatePath: localui.LocalUIDeviceCACertificatePath(layout.StateDir)}
			if errors.Is(err, localui.ErrLocalUIDeviceCAManual) {
				report.Status = "manual_required"
				report.Message = "Import the public CA certificate into the current user's browser or OS trust store; Redeven will not invoke sudo or modify system-wide trust."
			} else {
				report.Message = "Current-user trust installation did not complete."
			}
			writeLocalAuthorityReport(c.stderr, report)
			return 1
		}
		writeLocalAuthorityReport(c.stdout, localAuthorityReport{Operation: "device-ca-install", Status: "installed", Code: "local_ui_device_ca_installed", CertificatePath: localui.LocalUIDeviceCACertificatePath(layout.StateDir)})
		return 0
	default:
		if err := os.MkdirAll(layout.StateDir, 0o700); err != nil {
			writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-generate", Status: "failed", Code: "local_ui_device_ca_generation_failed", Message: "Local UI device CA generation did not complete."})
			return 1
		}
		lock, err := lockfile.Acquire(layout.LockPath)
		if err != nil {
			writeLocalAuthorityReport(c.stderr, localAuthorityFailureFor("device-ca-generate", err))
			return 1
		}
		defer func() { _ = lock.Release() }()
		status, err := localui.GenerateLocalUIDeviceCA(layout.StateDir)
		if err != nil {
			writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-generate", Status: "failed", Code: deviceCAErrorCode(err), Message: "Local UI device CA generation did not complete."})
			return 1
		}
		report := deviceCAReport(operation, status)
		report.Status = "generated"
		report.Code = "local_ui_device_ca_generated"
		writeLocalAuthorityReport(c.stdout, report)
		return 0
	}
}

func deviceCAReport(operation string, status localui.DeviceCAStatus) localAuthorityReport {
	return localAuthorityReport{
		Operation:       "device-ca-" + operation,
		Status:          "ready",
		Code:            "local_ui_device_ca_ready",
		Identity:        status.Identity,
		Trust:           status.Trust,
		NotAfter:        status.NotAfter,
		CertificatePath: status.CertPath,
	}
}

func deviceCAErrorCode(err error) string {
	switch {
	case errors.Is(err, localui.ErrLocalUIDeviceCAMissing):
		return "local_ui_device_ca_missing"
	case errors.Is(err, localui.ErrLocalUIDeviceCAExpired):
		return "local_ui_device_ca_expired"
	case errors.Is(err, localui.ErrLocalUIDeviceCAUntrusted):
		return "local_ui_device_ca_untrusted"
	case errors.Is(err, localui.ErrLocalUIDeviceCAManual):
		return "local_ui_device_ca_manual_install_required"
	default:
		return "local_ui_device_ca_invalid"
	}
}

func localAuthorityFailureFor(operation string, err error) localAuthorityReport {
	report := localAuthorityFailure(err)
	report.Operation = operation
	return report
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
