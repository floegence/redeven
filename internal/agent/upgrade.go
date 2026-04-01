package agent

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/session"
	syssvc "github.com/floegence/redeven/internal/sys"
)

const (
	defaultUpgradeInstallScriptURL = "https://redeven.com/install.sh"
	upgradeInstallScriptURLEnvKey  = "REDEVEN_UPGRADE_INSTALL_SCRIPT_URL"
	upgradeTimeout                 = 10 * time.Minute
)

var releaseTagPattern = regexp.MustCompile(`^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
var upgradeInstallScriptURL = resolveUpgradeInstallScriptURL()

func resolveUpgradeInstallScriptURL() string {
	v := strings.TrimSpace(os.Getenv(upgradeInstallScriptURLEnvKey))
	if v == "" {
		return defaultUpgradeInstallScriptURL
	}
	return v
}

type sysUpgrader struct {
	a *Agent
}

func normalizeTargetVersion(req *syssvc.UpgradeRequest) (string, error) {
	if req == nil {
		return "", nil
	}
	v := strings.TrimSpace(req.TargetVersion)
	if v == "" {
		return "", nil
	}
	if !releaseTagPattern.MatchString(v) {
		return "", &rpc.Error{Code: 400, Message: "invalid target_version (expected release tag like v1.2.3)"}
	}
	return v, nil
}

func (u *sysUpgrader) StartUpgrade(_ctx context.Context, meta *session.Meta, req *syssvc.UpgradeRequest) (*syssvc.UpgradeResponse, error) {
	if u == nil || u.a == nil {
		return nil, &rpc.Error{Code: 500, Message: "internal error"}
	}
	a := u.a

	if runtime.GOOS == "windows" {
		return &syssvc.UpgradeResponse{OK: false, Message: "Windows is not supported for self-upgrade. Please reinstall manually."}, nil
	}

	if req != nil && req.DryRun != nil && *req.DryRun {
		return &syssvc.UpgradeResponse{OK: true, Message: "Dry run ok."}, nil
	}

	targetVersion, err := normalizeTargetVersion(req)
	if err != nil {
		return nil, err
	}

	plan, err := resolveSelfExecPlan(a.runtimeStatePath)
	if err != nil {
		a.log.Warn("sys_upgrade: resolve self paths failed", "error", err)
		return nil, &rpc.Error{Code: 500, Message: "failed to resolve runtime executable path"}
	}

	if !a.maintenanceOp.CompareAndSwap(maintenanceOpNone, maintenanceOpUpgrade) {
		switch a.maintenanceOp.Load() {
		case maintenanceOpUpgrade:
			return &syssvc.UpgradeResponse{OK: false, Message: "Upgrade already in progress."}, nil
		case maintenanceOpRestart:
			return &syssvc.UpgradeResponse{OK: false, Message: "Restart is in progress."}, nil
		default:
			return &syssvc.UpgradeResponse{OK: false, Message: "Maintenance already in progress."}, nil
		}
	}

	userPublicID := ""
	channelID := ""
	if meta != nil {
		userPublicID = strings.TrimSpace(meta.UserPublicID)
		channelID = strings.TrimSpace(meta.ChannelID)
	}

	a.log.Info("sys_upgrade: started",
		"user_public_id", userPublicID,
		"channel_id", channelID,
		"exe_path", plan.exePath,
		"install_dir", plan.installDir,
		"local_ui_bind", plan.localUIBind,
		"target_version", targetVersion,
	)
	a.markMaintenanceRunning(syssvc.MaintenanceKindUpgrade, targetVersion, "Downloading and installing update...")

	go a.runSelfUpgrade(plan, userPublicID, channelID, targetVersion)

	msg := "Upgrade started. The runtime will restart shortly."
	if targetVersion != "" {
		msg = "Upgrade started for " + targetVersion + ". The runtime will restart shortly."
	}
	return &syssvc.UpgradeResponse{OK: true, Message: msg}, nil
}

func (a *Agent) runSelfUpgrade(plan selfExecPlan, userPublicID string, channelID string, targetVersion string) {
	// Allow the RPC response to flush before we potentially break active streams.
	time.Sleep(200 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), upgradeTimeout)
	defer cancel()

	// Run the official install.sh in upgrade mode, forcing the install directory to the
	// currently running executable directory so we restart into the new binary path.
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", "curl -fsSL "+upgradeInstallScriptURL+" | sh")
	env := append(os.Environ(),
		"REDEVEN_INSTALL_MODE=upgrade",
		"REDEVEN_INSTALL_DIR="+plan.installDir,
	)
	if targetVersion != "" {
		env = append(env, "REDEVEN_VERSION="+targetVersion)
	}
	cmd.Env = env

	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	if err := cmd.Run(); err != nil {
		failureMessage := summarizeUpgradeFailure(err, out.String())
		a.log.Error("sys_upgrade: install failed",
			"user_public_id", userPublicID,
			"channel_id", channelID,
			"target_version", targetVersion,
			"error", err,
			"output_len", out.Len(),
			"output_snippet", truncateForLog(out.String(), 8_000),
		)
		a.markMaintenanceFailed(syssvc.MaintenanceKindUpgrade, targetVersion, failureMessage)
		a.maintenanceOp.Store(maintenanceOpNone)
		return
	}

	a.log.Info("sys_upgrade: install completed",
		"user_public_id", userPublicID,
		"channel_id", channelID,
		"target_version", targetVersion,
		"output_len", out.Len(),
	)

	// Best-effort cleanup to avoid orphaning child processes after exec.
	a.stopAllSessions()
	if a.code != nil {
		_ = a.code.Close()
	}
	if a.term != nil {
		a.term.Cleanup()
	}

	a.log.Info("sys_upgrade: restarting",
		"user_public_id", userPublicID,
		"channel_id", channelID,
		"exe_path", plan.exePath,
		"local_ui_bind", plan.localUIBind,
	)

	if err := syscall.Exec(plan.exePath, plan.argv, os.Environ()); err != nil {
		failureMessage := summarizeExecFailure("Upgrade restart failed", err)
		a.log.Error("sys_upgrade: exec failed",
			"user_public_id", userPublicID,
			"channel_id", channelID,
			"error", err,
		)
		a.markMaintenanceFailed(syssvc.MaintenanceKindUpgrade, targetVersion, failureMessage)
		a.maintenanceOp.Store(maintenanceOpNone)
		return
	}
}

func summarizeUpgradeFailure(err error, output string) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "Install failed: the upgrade installer timed out."
	}
	if trimmed := compactUserFacingOutput(output); trimmed != "" {
		return "Install failed: " + trimmed
	}
	if err != nil {
		return "Install failed: " + strings.TrimSpace(err.Error())
	}
	return "Install failed."
}

func summarizeExecFailure(prefix string, err error) string {
	cleanPrefix := strings.TrimSpace(prefix)
	if err == nil {
		if cleanPrefix == "" {
			return "Runtime restart failed."
		}
		return cleanPrefix + "."
	}
	if cleanPrefix == "" {
		return strings.TrimSpace(err.Error())
	}
	return cleanPrefix + ": " + strings.TrimSpace(err.Error())
}

func compactUserFacingOutput(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	lines := strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		clean := strings.TrimSpace(line)
		if clean == "" {
			continue
		}
		parts = append(parts, clean)
		if len(parts) >= 3 {
			break
		}
	}

	out := strings.Join(parts, " | ")
	if len(out) > 240 {
		return out[:240] + "...(truncated)"
	}
	return out
}

func truncateForLog(s string, max int) string {
	if max <= 0 {
		return ""
	}
	t := strings.TrimSpace(s)
	if len(t) <= max {
		return t
	}
	return t[:max] + "...(truncated)"
}
