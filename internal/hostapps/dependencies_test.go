package hostapps

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func dependencyFixture(t *testing.T, version string, server, html bool) string {
	t.Helper()
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	resources := filepath.Join(root, "shared assets")
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	help := "xpra info [DISPLAY]"
	if server {
		help += "\nxpra upgrade [DISPLAY]"
	}
	script := "#!/bin/sh\ncase \"$1\" in\n--version) printf '%s\\n' " + quoteArgv([]string{version}) + ";;\n--help) printf '%s\\n' " + quoteArgv([]string{help}) + ";;\npath-info) printf '%s\\n' " + quoteArgv([]string{"* resources : " + resources}) + ";;\nesac\n"
	for name, body := range map[string]string{"xpra": script, "python3": "#!/bin/sh\nexit 0\n", "Xvfb": "#!/bin/sh\n", "dbus-run-session": "#!/bin/sh\n", "dbus-daemon": "#!/bin/sh\n", "xauth": "#!/bin/sh\n"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if html {
		for _, name := range []string{"index.html", "js/Client.js", "js/Window.js", "js/Utilities.js"} {
			path := filepath.Join(resources, "www", name)
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(`VERSION : "20",`), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	return bin
}

func TestDependenciesRejectMissingHTMLAndClientOnlyInstallations(t *testing.T) {
	for _, test := range []struct {
		name         string
		server, html bool
		missing      string
	}{
		{"missing HTML5", true, false, "Xpra HTML5 v20 / v21"},
		{"client only", false, true, "Xpra X11 server"},
	} {
		t.Run(test.name, func(t *testing.T) {
			bin := dependencyFixture(t, "xpra v6.5.3", test.server, test.html)
			a, _ := detectDependencies(context.Background(), "linux", []string{"PATH=" + bin})
			if a.Ready || !slices.Contains(a.Requirements, test.missing) {
				t.Fatalf("incomplete installation accepted: %+v", a)
			}
		})
	}
}

func TestDependenciesUseInstalledPathsAndFindGIOBeyondAVirtualEnvironment(t *testing.T) {
	bin := dependencyFixture(t, "xpra v6.5.3", true, true)
	venv := t.TempDir()
	if err := os.WriteFile(filepath.Join(venv, "python3"), []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	a, tools := detectDependencies(context.Background(), "linux", []string{"PATH=" + venv + string(os.PathListSeparator) + bin})
	if !a.Ready || tools.python != filepath.Join(bin, "python3") || tools.html != filepath.Join(filepath.Dir(bin), "shared assets", "www") {
		t.Fatalf("incorrect installed dependency resolution: %+v %+v", a, tools)
	}
}

func TestDependenciesDoNotClaimFutureOrOldVersionsAndNeverProbeUnsupportedHosts(t *testing.T) {
	for _, version := range []string{"xpra v5.1.4", "xpra v7.0"} {
		bin := dependencyFixture(t, version, true, true)
		a, _ := detectDependencies(context.Background(), "linux", []string{"PATH=" + bin})
		if a.Ready || a.Reason != "unsupported_version" {
			t.Fatalf("unsupported version accepted: %+v", a)
		}
	}
	a, _ := detectDependencies(context.Background(), "darwin", nil)
	if a.Supported || a.Ready || a.Reason != "unsupported_platform" {
		t.Fatalf("macOS host advertised Linux capability: %+v", a)
	}
}

func TestHTMLClientVersionsAndIncompleteAssets(t *testing.T) {
	for _, version := range []string{"19", "20", "21", "22"} {
		t.Run(version, func(t *testing.T) {
			bin := dependencyFixture(t, "xpra v6.5.3", true, true)
			html := filepath.Join(filepath.Dir(bin), "shared assets", "www")
			if err := os.WriteFile(filepath.Join(html, "js", "Utilities.js"), []byte(`var Utilities={VERSION:"`+version+`",REVISION:0};`), 0600); err != nil {
				t.Fatal(err)
			}
			a, _ := detectDependencies(context.Background(), "linux", []string{"PATH=" + bin})
			if a.Ready != (version == "20" || version == "21") {
				t.Fatalf("incorrect HTML5 compatibility: %+v", a)
			}
			if err := os.Remove(filepath.Join(html, "js", "Window.js")); err != nil {
				t.Fatal(err)
			}
			a, _ = detectDependencies(context.Background(), "linux", []string{"PATH=" + bin})
			if a.Ready {
				t.Fatal("incomplete HTML5 installation accepted")
			}
		})
	}
}

func TestRelativeExecutableDirectoriesAreNotSearched(t *testing.T) {
	if paths := executablePaths("python3", []string{"PATH=.:relative:"}); len(paths) != 0 {
		t.Fatalf("unsafe executable search: %v", paths)
	}
}
