package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/localui"
	"github.com/floegence/redeven/internal/lockfile"
)

const localAuthorityReportSchemaVersion = "redeven.local_authority_maintenance.v1"

type localAuthorityReport struct {
	SchemaVersion         string `json:"schema_version"`
	Operation             string `json:"operation"`
	Status                string `json:"status"`
	Code                  string `json:"code"`
	Message               string `json:"message,omitempty"`
	PreviousVersion       int    `json:"previous_version,omitempty"`
	CurrentVersion        int    `json:"current_version,omitempty"`
	RetainedKeys          int    `json:"retained_keys,omitempty"`
	Identity              string `json:"identity,omitempty"`
	Trust                 string `json:"trust,omitempty"`
	NotAfter              string `json:"not_after,omitempty"`
	CertificatePath       string `json:"certificate_path,omitempty"`
	OutputPath            string `json:"output_path,omitempty"`
	CertificateKind       string `json:"certificate_kind,omitempty"`
	Fingerprint           string `json:"fingerprint,omitempty"`
	CertificateManagement bool   `json:"certificate_management,omitempty"`
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
	if operation == "access" {
		return c.localAuthorityAccessCmd(args[1:])
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

func (c *cli) localAuthorityAccessCmd(args []string) int {
	if len(args) == 0 || (args[0] != "get" && args[0] != "set") {
		writeText(c.stderr, "Usage: redeven local-authority access get|set --state-root <path>\nSet reads one access settings JSON object from stdin. Stop Runtime before using set.\n")
		return 2
	}
	fs := newCLIFlagSet("local-authority access " + args[0])
	stateRoot := fs.String("state-root", "", "Exact Redeven state root")
	if err := parseCommandFlags(fs, args[1:]); err != nil {
		writeText(c.stderr, err.Error()+"\n")
		return 2
	}
	if strings.TrimSpace(*stateRoot) == "" {
		writeText(c.stderr, "--state-root is required\n")
		return 2
	}
	layout, err := config.LocalEnvironmentStateLayout(*stateRoot)
	if err != nil {
		writeText(c.stderr, err.Error()+"\n")
		return 2
	}
	var access *config.EnvironmentCatalogAccess
	if args[0] == "get" {
		access, err = config.ReadEnvironmentCatalogAccess(layout)
		if err == nil && access == nil {
			access = &config.EnvironmentCatalogAccess{LocalUIBind: "localhost:23998", LocalUIProtocol: "http"}
		}
	} else {
		var input localui.RuntimeAccessUpdate
		decoder := json.NewDecoder(io.LimitReader(c.stdin, startupSecretsEnvelopeMaxLen+1))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			writeText(c.stderr, "Invalid access settings JSON\n")
			return 2
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			writeText(c.stderr, "Expected one access settings object\n")
			return 2
		}
		if err := os.MkdirAll(layout.StateDir, 0700); err != nil {
			writeText(c.stderr, err.Error()+"\n")
			return 1
		}
		lock, lockErr := lockfile.Acquire(layout.LockPath)
		if lockErr != nil {
			writeText(c.stderr, "Stop Runtime before saving access settings through the CLI, or use its authenticated Desktop management connection.\n")
			return 1
		}
		defer func() { _ = lock.Release() }()
		access, err = localui.SaveRuntimeAccess(layout, input)
	}
	if err != nil {
		writeText(c.stderr, err.Error()+"\n")
		return 1
	}
	if err := json.NewEncoder(c.stdout).Encode(access); err != nil {
		return 1
	}
	return 0
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
	if operation != "generate" && operation != "status" && operation != "export" && operation != "install" && operation != "import" && operation != "regenerate" && operation != "remove" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca", Status: "failed", Code: "invalid_operation", Message: "device-ca requires generate, status, export, install, import, regenerate, or remove"})
		return 2
	}
	fs := newCLIFlagSet("local-authority device-ca " + operation)
	stateRoot := fs.String("state-root", "", "Exact Redeven state root")
	outputPath := fs.String("output", "", "New public CA certificate export path")
	scope := fs.String("scope", "user", "Trust scope; only user is supported")
	bind := fs.String("bind", "", "Verify certificate coverage for the next HTTPS bind")
	confirm := fs.Bool("confirm", false, "Confirm certificate replacement or removal")
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
	if operation != "status" && *bind != "" {
		writeLocalAuthorityReport(c.stderr, localAuthorityReport{Status: "failed", Code: "invalid_arguments", Message: "--bind is valid only for device-ca status"})
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

	if operation == "import" || operation == "regenerate" || operation == "remove" {
		if !*confirm {
			writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-" + operation, Status: "failed", Code: "confirmation_required", Message: "--confirm is required; certificate changes affect the next HTTPS start and may require new client trust"})
			return 2
		}
		var status localui.DeviceCAStatus
		var mutationErr error
		switch operation {
		case "import":
			var input localui.CertificateImport
			body, readErr := io.ReadAll(io.LimitReader(c.stdin, 3*1024*1024+1))
			if readErr != nil || len(body) > 3*1024*1024 {
				writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-import", Status: "failed", Code: "invalid_arguments", Message: "Certificate import input must not exceed 3 MiB"})
				return 2
			}
			decoder := json.NewDecoder(bytes.NewReader(body))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF {
				writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-import", Status: "failed", Code: "invalid_arguments", Message: "Import requires one JSON object with certificate_pem and private_key_pem on stdin"})
				return 2
			}
			status, mutationErr = localui.ImportLocalUICertificate(layout.StateDir, input)
		case "regenerate":
			status, mutationErr = localui.RegenerateLocalUIDeviceCA(layout.StateDir)
		case "remove":
			status, mutationErr = localui.RemoveLocalUICertificate(layout.StateDir)
		}
		if mutationErr != nil {
			current, _ := localui.InspectLocalUIDeviceCA(layout.StateDir)
			report := deviceCAReport(operation, current)
			report.Status = "failed"
			report.Code = "local_ui_certificate_" + operation + "_failed"
			report.Message = mutationErr.Error()
			writeLocalAuthorityReport(c.stderr, report)
			return 1
		}
		report := deviceCAReport(operation, status)
		report.Status = "updated"
		report.Code = "local_ui_certificate_" + operation + "_complete"
		writeLocalAuthorityReport(c.stdout, report)
		return 0
	}

	switch operation {
	case "status":
		status, statusErr := localui.InspectLocalUIDeviceCA(layout.StateDir)
		report := deviceCAReport(operation, status)
		if statusErr != nil {
			report.Status = "failed"
			report.Code = deviceCAErrorCode(statusErr)
			report.Message = statusErr.Error()
			writeLocalAuthorityReport(c.stderr, report)
			return 1
		}
		if *bind != "" {
			if err := localui.ValidateLocalUICertificateForBind(layout.StateDir, *bind); err != nil {
				report.Status = "failed"
				report.Code = "local_ui_certificate_bind_invalid"
				report.Message = err.Error()
				writeLocalAuthorityReport(c.stderr, report)
				return 1
			}
		}
		if status.Trust == "manual_required" {
			report.Status = "manual_required"
			report.Code = "local_ui_device_ca_manual_install_required"
			report.Message = status.Remedy
		}
		if status.Trust == "untrusted" {
			report.Code = "local_ui_device_ca_untrusted"
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
				report.Message = err.Error()
			}
			writeLocalAuthorityReport(c.stderr, report)
			return 1
		}
		writeLocalAuthorityReport(c.stdout, localAuthorityReport{Operation: "device-ca-install", Status: "installed", Code: "local_ui_device_ca_installed", CertificatePath: localui.LocalUIDeviceCACertificatePath(layout.StateDir)})
		return 0
	default:
		if err := os.MkdirAll(layout.StateDir, 0o700); err != nil {
			writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-generate", Status: "failed", Code: deviceCAErrorCode(err), Message: "Local UI device CA generation did not complete."})
			return 1
		}
		status, err := localui.GenerateLocalUIDeviceCA(layout.StateDir)
		if err != nil {
			writeLocalAuthorityReport(c.stderr, localAuthorityReport{Operation: "device-ca-generate", Status: "failed", Code: deviceCAErrorCode(err), Message: err.Error()})
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
		Operation:             "device-ca-" + operation,
		Status:                "ready",
		Code:                  "local_ui_device_ca_ready",
		Identity:              status.Identity,
		Trust:                 status.Trust,
		NotAfter:              status.NotAfter,
		CertificatePath:       status.CertPath,
		CertificateKind:       status.Kind,
		Fingerprint:           status.Fingerprint,
		CertificateManagement: true,
	}
}

func deviceCAErrorCode(err error) string {
	switch {
	case errors.Is(err, lockfile.ErrAlreadyLocked):
		return "local_ui_device_ca_busy"
	case errors.Is(err, context.DeadlineExceeded):
		return "local_ui_device_ca_timeout"
	case errors.Is(err, os.ErrPermission):
		return "local_ui_device_ca_permission_denied"
	case errors.Is(err, localui.ErrLocalUIDeviceCAExists):
		return "local_ui_device_ca_exists"
	case errors.Is(err, localui.ErrLocalUIDeviceCAInstallCanceled):
		return "local_ui_device_ca_install_canceled"
	case errors.Is(err, localui.ErrLocalUIDeviceCAInstallFailed):
		return "local_ui_device_ca_install_failed"
	case errors.Is(err, localui.ErrLocalUIDeviceCANotYetValid):
		return "local_ui_device_ca_not_yet_valid"
	case errors.Is(err, localui.ErrLocalUIDeviceCAInvalid):
		return "local_ui_device_ca_invalid"
	case errors.Is(err, localui.ErrLocalUIDeviceCAMissing):
		return "local_ui_device_ca_missing"
	case errors.Is(err, localui.ErrLocalUIDeviceCAExpired):
		return "local_ui_device_ca_expired"
	case errors.Is(err, localui.ErrLocalUIDeviceCAUntrusted):
		return "local_ui_device_ca_untrusted"
	case errors.Is(err, localui.ErrLocalUIDeviceCAManual):
		return "local_ui_device_ca_manual_install_required"
	default:
		return "local_ui_device_ca_operation_failed"
	}
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
