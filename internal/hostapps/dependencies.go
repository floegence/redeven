package hostapps

import (
	"context"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"golang.org/x/net/html"
)

// Resolve installed capabilities, never a distribution name or package manager.
// Keep these exact paths for launch so a different Python/Xpra cannot take over
// between catalog discovery and the application process.
type hostTools struct {
	managed                        *nativeapps.Tools
	desktop                        *nativeapps.DesktopTools
	componentDigest                string
	xpra, python, xvfb, dbus, html string
	inputPython                    string
}

func detectDependencies(ctx context.Context, platform string, env []string) (Availability, hostTools) {
	a := Availability{Supported: platform == "linux"}
	var tools hostTools
	if !a.Supported {
		a.Reason = "unsupported_platform"
		return a, tools
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	require := func(name string) string {
		paths := executablePaths(name, env)
		if len(paths) == 0 {
			a.Requirements = append(a.Requirements, name)
			return ""
		}
		return paths[0]
	}
	tools.xpra = require("xpra")
	tools.xvfb = require("Xvfb")
	tools.dbus = require("dbus-run-session")
	require("dbus-daemon")
	require("xauth")
	tools.python = desktopPython(ctx, env)
	if tools.python == "" {
		a.Requirements = append(a.Requirements, "Python GIO/GTK 3")
	}
	if tools.xpra != "" {
		version, err := commandOutput(ctx, xpraEnvironment(env), tools.xpra, "--version")
		a.Version = strings.TrimSpace(string(version))
		if err != nil {
			a.Requirements = append(a.Requirements, "xpra")
		} else if !supportedVersion(a.Version) {
			a.Reason = "unsupported_version"
			a.Requirements = append(a.Requirements, "Xpra 6.x")
		} else {
			// Xpra advertises local upgrade only when both the X11 and server
			// packages exist. Info is required for actual-window readiness.
			help, err := commandOutput(ctx, xpraEnvironment(env), tools.xpra, "--help")
			if err != nil || !strings.Contains(string(help), "upgrade [DISPLAY]") || !strings.Contains(string(help), "info [DISPLAY]") {
				a.Requirements = append(a.Requirements, "Xpra X11 server")
			}
			paths, err := commandOutput(ctx, xpraEnvironment(env), tools.xpra, "path-info")
			if err == nil {
				tools.html = installedHTML(string(paths))
			}
			if tools.html == "" {
				a.Requirements = append(a.Requirements, "Xpra HTML5 v20 / v21")
			}
		}
	}
	a.Ready = len(a.Requirements) == 0
	if !a.Ready && a.Reason == "" {
		a.Reason = "missing_dependencies"
	}
	return a, tools
}

func commandOutput(ctx context.Context, env []string, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = env
	return cmd.Output()
}

func executablePaths(name string, env []string) []string {
	path := ""
	for _, item := range env {
		if value, ok := strings.CutPrefix(item, "PATH="); ok {
			path = value
		}
	}
	var result []string
	seen := map[string]bool{}
	for _, directory := range filepath.SplitList(path) {
		// A service must not execute a same-named file from its working directory.
		if !filepath.IsAbs(directory) {
			continue
		}
		candidate := filepath.Join(directory, name)
		if seen[candidate] {
			continue
		}
		seen[candidate] = true
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			result = append(result, candidate)
		}
	}
	return result
}

func desktopPython(ctx context.Context, env []string) string {
	// GIO belongs to the host's desktop stack. Xpra can use its own interpreter,
	// including a newer Python on enterprise Linux or a virtual environment.
	for _, candidate := range executablePaths("python3", env) {
		if _, err := commandOutput(ctx, env, candidate, "-c", "import gi; gi.require_version('Gtk', '3.0'); from gi.repository import Gio, Gtk; assert Gio.DesktopAppInfo"); err == nil {
			return candidate
		}
	}
	return ""
}

var htmlVersion = regexp.MustCompile(`\bVERSION\s*:\s*["'](?:20|21)["']`)

func installedHTML(paths string) string {
	// Ask the executable for its resource root. This works with distribution
	// packages, alternate installation prefixes and Xpra's resource override.
	for _, line := range strings.Split(paths, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(key) != "* resources" {
			continue
		}
		root := strings.TrimSpace(value)
		if !filepath.IsAbs(root) {
			return ""
		}
		for _, name := range []string{"www", "html5"} {
			dir := filepath.Join(root, name)
			valid := true
			for _, file := range []string{"index.html", "js/Client.js", "js/Window.js", "js/Utilities.js"} {
				data, err := os.ReadFile(filepath.Join(dir, file))
				if err != nil || len(data) == 0 || (file == "js/Utilities.js" && !htmlVersion.Match(data)) {
					valid = false
					break
				}
			}
			if valid && htmlResourcesReadable(dir) {
				return dir
			}
		}
	}
	return ""
}

func htmlResourcesReadable(dir string) bool {
	index, err := os.Open(filepath.Join(dir, "index.html"))
	if err != nil {
		return false
	}
	defer index.Close()
	tokens := html.NewTokenizer(index)
	for {
		kind := tokens.Next()
		if kind == html.ErrorToken {
			return tokens.Err() == io.EOF
		}
		if kind != html.StartTagToken && kind != html.SelfClosingTagToken {
			continue
		}
		tag := tokens.Token()
		attributes := map[string]string{}
		for _, attr := range tag.Attr {
			attributes[attr.Key] = attr.Val
		}
		reference := ""
		if tag.Data == "script" {
			reference = attributes["src"]
		} else if tag.Data == "link" && attributes["rel"] == "stylesheet" {
			reference = attributes["href"]
		}
		if reference == "" {
			continue
		}
		resource, err := url.Parse(reference)
		if err != nil || resource.IsAbs() || resource.Host != "" || resource.Path == "" || strings.HasPrefix(resource.Path, "/") {
			return false
		}
		path := filepath.Join(dir, filepath.FromSlash(resource.Path))
		relative, err := filepath.Rel(dir, path)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return false
		}
		// Distribution packages may use absolute symlinks into shared JavaScript
		// directories. Follow them, but never advertise a broken installation.
		file, err := os.Open(path)
		if err != nil {
			return false
		}
		info, err := file.Stat()
		_ = file.Close()
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return false
		}
	}
}

// An owned session must not inherit distribution/user Xpra settings that start
// unrelated applications, add listeners, or attach to an existing display.
func xpraEnvironment(env []string) []string {
	out := make([]string, 0, len(env)+3)
	for _, item := range env {
		key, _, _ := strings.Cut(item, "=")
		switch key {
		case "XPRA_DEFAULT_CONF_DIRS", "XPRA_SYSTEM_CONF_DIRS", "XPRA_USER_CONF_DIRS", "XPRA_PRIVATE_XAUTH", "XPRA_SHARED_XAUTHORITY":
			continue
		}
		out = append(out, item)
	}
	return append(out, "XPRA_PRIVATE_XAUTH=1", "XPRA_SHARED_XAUTHORITY=0", "XPRA_DEFAULT_CONF_DIRS=", "XPRA_SYSTEM_CONF_DIRS=", "XPRA_USER_CONF_DIRS=")
}
