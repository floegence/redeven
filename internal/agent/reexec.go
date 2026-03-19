package agent

import (
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	localuiruntime "github.com/floegence/redeven-agent/internal/localui/runtime"
)

type selfExecPlan struct {
	exePath     string
	installDir  string
	argv        []string
	localUIBind string
}

func resolveSelfExecPlan(runtimeStatePath string) (selfExecPlan, error) {
	exePath, err := os.Executable()
	if err != nil {
		return selfExecPlan{}, err
	}
	exePath = strings.TrimSpace(exePath)
	if exePath == "" {
		return selfExecPlan{}, os.ErrInvalid
	}
	if abs, absErr := filepath.Abs(exePath); absErr == nil && strings.TrimSpace(abs) != "" {
		exePath = abs
	}
	exePath = filepath.Clean(exePath)
	installDir := filepath.Clean(filepath.Dir(exePath))
	if strings.TrimSpace(installDir) == "" {
		return selfExecPlan{}, os.ErrInvalid
	}

	argv := rewriteSelfExecArgs(os.Args, runtimeStatePath)
	return selfExecPlan{
		exePath:     exePath,
		installDir:  installDir,
		argv:        argv,
		localUIBind: currentLocalUIBindArg(argv),
	}, nil
}

func rewriteSelfExecArgs(argv []string, runtimeStatePath string) []string {
	if len(argv) == 0 {
		return nil
	}
	runtimeBind, ok := runtimeBindAddress(runtimeStatePath)
	if !ok {
		return append([]string(nil), argv...)
	}

	out := append([]string(nil), argv...)
	for i := 1; i < len(out); i++ {
		arg := strings.TrimSpace(out[i])
		switch {
		case arg == "--local-ui-bind" && i+1 < len(out):
			if !isDynamicBindArg(out[i+1]) {
				return out
			}
			out[i+1] = runtimeBind
			return out
		case strings.HasPrefix(arg, "--local-ui-bind="):
			currentValue := strings.TrimSpace(strings.TrimPrefix(arg, "--local-ui-bind="))
			if !isDynamicBindArg(currentValue) {
				return out
			}
			out[i] = "--local-ui-bind=" + runtimeBind
			return out
		}
	}
	return out
}

func runtimeBindAddress(runtimeStatePath string) (string, bool) {
	snapshot, err := localuiruntime.Load(runtimeStatePath)
	if err != nil || snapshot == nil {
		return "", false
	}
	bindAddress, err := snapshot.BindAddress()
	if err != nil {
		return "", false
	}
	return bindAddress, true
}

func isDynamicBindArg(raw string) bool {
	_, port, ok := splitBindHostPort(raw)
	return ok && port == 0
}

func currentLocalUIBindArg(argv []string) string {
	for i := 1; i < len(argv); i++ {
		arg := strings.TrimSpace(argv[i])
		switch {
		case arg == "--local-ui-bind" && i+1 < len(argv):
			return strings.TrimSpace(argv[i+1])
		case strings.HasPrefix(arg, "--local-ui-bind="):
			return strings.TrimSpace(strings.TrimPrefix(arg, "--local-ui-bind="))
		}
	}
	return ""
}

func splitBindHostPort(raw string) (string, int, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", 0, false
	}
	host, portRaw, err := net.SplitHostPort(value)
	if err != nil {
		return "", 0, false
	}
	port, err := strconv.Atoi(strings.TrimSpace(portRaw))
	if err != nil || port < 0 || port > 65535 {
		return "", 0, false
	}
	return strings.TrimSpace(host), port, true
}
