package agent

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/session"
	syssvc "github.com/floegence/redeven-agent/internal/sys"
)

const (
	upgradeInstallScriptURL = "https://example.invalid/install.sh"
	upgradeTimeout          = 10 * time.Minute
)

type sysUpgrader struct {
	a *Agent
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

	exePath, installDir, err := resolveSelfUpgradePaths()
	if err != nil {
		a.log.Warn("sys_upgrade: resolve self paths failed", "error", err)
		return nil, &rpc.Error{Code: 500, Message: "failed to resolve agent executable path"}
	}

	if !a.upgrading.CompareAndSwap(false, true) {
		return &syssvc.UpgradeResponse{OK: false, Message: "Upgrade already in progress."}, nil
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
		"exe_path", exePath,
		"install_dir", installDir,
	)

	go a.runSelfUpgrade(exePath, installDir, userPublicID, channelID)

	return &syssvc.UpgradeResponse{
		OK:      true,
		Message: "Upgrade started. The agent will restart shortly.",
	}, nil
}

func resolveSelfUpgradePaths() (exePath string, installDir string, err error) {
	exePath, err = os.Executable()
	if err != nil {
		return "", "", err
	}
	exePath = strings.TrimSpace(exePath)
	if exePath == "" {
		return "", "", os.ErrInvalid
	}
	if abs, absErr := filepath.Abs(exePath); absErr == nil && strings.TrimSpace(abs) != "" {
		exePath = abs
	}
	exePath = filepath.Clean(exePath)
	installDir = filepath.Clean(filepath.Dir(exePath))
	if strings.TrimSpace(installDir) == "" {
		return "", "", os.ErrInvalid
	}
	return exePath, installDir, nil
}

func (a *Agent) runSelfUpgrade(exePath string, installDir string, userPublicID string, channelID string) {
	// Allow the RPC response to flush before we potentially break active streams.
	time.Sleep(200 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), upgradeTimeout)
	defer cancel()

	// Run the official install.sh in upgrade mode, forcing the install directory to the
	// currently running executable directory so we restart into the new binary path.
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", "curl -fsSL "+upgradeInstallScriptURL+" | sh")
	cmd.Env = append(os.Environ(),
		"REDEVEN_INSTALL_MODE=upgrade",
		"REDEVEN_INSTALL_DIR="+installDir,
	)

	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	if err := cmd.Run(); err != nil {
		a.log.Error("sys_upgrade: install failed",
			"user_public_id", userPublicID,
			"channel_id", channelID,
			"error", err,
			"output_len", out.Len(),
			"output_snippet", truncateForLog(out.String(), 8_000),
		)
		a.upgrading.Store(false)
		return
	}

	a.log.Info("sys_upgrade: install completed",
		"user_public_id", userPublicID,
		"channel_id", channelID,
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
		"exe_path", exePath,
	)

	if err := syscall.Exec(exePath, os.Args, os.Environ()); err != nil {
		a.log.Error("sys_upgrade: exec failed",
			"user_public_id", userPublicID,
			"channel_id", channelID,
			"error", err,
		)
		a.upgrading.Store(false)
		return
	}
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
