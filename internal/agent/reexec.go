package agent

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/floegence/redeven/internal/runtimeidentity"
)

type selfExecPlan struct {
	exePath        string
	installDir     string
	activationPath string
	argv           []string
	localUIBind    string
}

func resolveSelfExecPlan(exePath string, localUIBind string) (selfExecPlan, error) {
	exePath = filepath.Clean(strings.TrimSpace(exePath))
	if exePath == "" || !filepath.IsAbs(exePath) {
		return selfExecPlan{}, errors.New("canonical executable path is unavailable")
	}
	installDir, err := runtimeidentity.RuntimeSuiteActivationRoot(exePath)
	if err != nil {
		return selfExecPlan{}, err
	}

	argv := rewriteSelfExecArgs(os.Args, localUIBind)
	return selfExecPlan{
		exePath:        exePath,
		installDir:     installDir,
		activationPath: filepath.Join(installDir, "redeven"),
		argv:           argv,
		localUIBind:    currentLocalUIBindArg(argv),
	}, nil
}

func rewriteSelfExecArgs(argv []string, runtimeBind string) []string {
	if len(argv) == 0 {
		return nil
	}
	runtimeBind = strings.TrimSpace(runtimeBind)
	if runtimeBind == "" {
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
