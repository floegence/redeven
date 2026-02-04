package agent

import (
	"context"
	"os"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/session"
	syssvc "github.com/floegence/redeven-agent/internal/sys"
)

const restartDelay = 200 * time.Millisecond

type sysRestarter struct {
	a *Agent
}

func (r *sysRestarter) StartRestart(_ctx context.Context, meta *session.Meta, _ *syssvc.RestartRequest) (*syssvc.RestartResponse, error) {
	if r == nil || r.a == nil {
		return nil, &rpc.Error{Code: 500, Message: "internal error"}
	}
	a := r.a

	if runtime.GOOS == "windows" {
		return &syssvc.RestartResponse{OK: false, Message: "Windows is not supported for self-restart. Please restart manually."}, nil
	}

	exePath, _, err := resolveSelfExecPaths()
	if err != nil {
		a.log.Warn("sys_restart: resolve self paths failed", "error", err)
		return nil, &rpc.Error{Code: 500, Message: "failed to resolve agent executable path"}
	}

	if !a.maintenance.CompareAndSwap(maintenanceOpNone, maintenanceOpRestart) {
		switch a.maintenance.Load() {
		case maintenanceOpUpgrade:
			return &syssvc.RestartResponse{OK: false, Message: "Upgrade is in progress."}, nil
		case maintenanceOpRestart:
			return &syssvc.RestartResponse{OK: false, Message: "Restart already in progress."}, nil
		default:
			return &syssvc.RestartResponse{OK: false, Message: "Maintenance already in progress."}, nil
		}
	}

	userPublicID := ""
	channelID := ""
	if meta != nil {
		userPublicID = strings.TrimSpace(meta.UserPublicID)
		channelID = strings.TrimSpace(meta.ChannelID)
	}

	a.log.Info("sys_restart: started",
		"user_public_id", userPublicID,
		"channel_id", channelID,
		"exe_path", exePath,
	)

	go a.runSelfRestart(exePath, userPublicID, channelID)

	return &syssvc.RestartResponse{
		OK:      true,
		Message: "Restart started. The agent will restart shortly.",
	}, nil
}

func (a *Agent) runSelfRestart(exePath string, userPublicID string, channelID string) {
	// Allow the RPC response to flush before we break active streams.
	time.Sleep(restartDelay)

	// Best-effort cleanup to avoid orphaning child processes after exec.
	a.stopAllSessions()
	if a.code != nil {
		_ = a.code.Close()
	}
	if a.term != nil {
		a.term.Cleanup()
	}

	a.log.Info("sys_restart: restarting",
		"user_public_id", userPublicID,
		"channel_id", channelID,
		"exe_path", exePath,
	)

	if err := syscall.Exec(exePath, os.Args, os.Environ()); err != nil {
		a.log.Error("sys_restart: exec failed",
			"user_public_id", userPublicID,
			"channel_id", channelID,
			"error", err,
		)
		a.maintenance.Store(maintenanceOpNone)
		return
	}
}
