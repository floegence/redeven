package installer

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func runtimeFixture(version string) map[string][]byte {
	files := map[string][]byte{}
	for name := range runtimeFiles {
		files[name] = []byte("fixture evidence for " + name)
	}
	files["redeven"] = []byte("#!/bin/sh\nprintf 'redeven " + version + " (fixture) test\\n'\n")
	files["redevplugin-runtime"] = []byte("#!/bin/sh\nexit 0\n")
	return files
}

func tarFixture(t *testing.T, files map[string][]byte, extra ...tar.Header) ([]byte, string) {
	t.Helper()
	var output bytes.Buffer
	compressed := gzip.NewWriter(&output)
	archive := tar.NewWriter(compressed)
	for name, content := range files {
		if err := archive.WriteHeader(&tar.Header{Name: name, Mode: 0755, Size: int64(len(content)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := archive.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	for _, header := range extra {
		if err := archive.WriteHeader(&header); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(output.Bytes())
	return output.Bytes(), hex.EncodeToString(sum[:])
}

func writeArchive(t *testing.T, contents []byte) string {
	t.Helper()
	name := filepath.Join(t.TempDir(), "archive.tar.gz")
	if err := os.WriteFile(name, contents, 0600); err != nil {
		t.Fatal(err)
	}
	return name
}

func TestClosedRuntimeArchive(t *testing.T) {
	for _, name := range []string{"../outside", "/absolute", "unrecognized", "redeven"} {
		t.Run(name, func(t *testing.T) {
			data, sum := tarFixture(t, runtimeFixture("v1.2.3"), tar.Header{Name: name, Mode: 0644, Typeflag: tar.TypeReg})
			if _, err := extractArchive(t.Context(), writeArchive(t, data), sum, t.TempDir(), ""); err == nil {
				t.Fatal("unsafe or duplicate runtime archive was accepted")
			}
		})
	}
	for _, kind := range []byte{tar.TypeLink, tar.TypeSymlink, tar.TypeFifo} {
		data, sum := tarFixture(t, runtimeFixture("v1.2.3"), tar.Header{Name: "other", Linkname: "redeven", Typeflag: kind})
		if _, err := extractArchive(t.Context(), writeArchive(t, data), sum, t.TempDir(), ""); err == nil {
			t.Fatal("non-regular runtime member was accepted")
		}
	}
	files := runtimeFixture("v1.2.3")
	delete(files, "redevplugin-runtime.sig")
	data, sum := tarFixture(t, files)
	if _, err := extractArchive(t.Context(), writeArchive(t, data), sum, t.TempDir(), ""); err == nil {
		t.Fatal("incomplete release evidence was accepted")
	}
}

func stageFixture(t *testing.T, root, version string, contents map[string][]byte) (string, map[string]string) {
	t.Helper()
	data, sum := tarFixture(t, contents)
	staging, err := os.MkdirTemp(root, ".fixture-")
	if err != nil {
		t.Fatal(err)
	}
	hashes, err := extractArchive(t.Context(), writeArchive(t, data), sum, staging, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := publishSuite(t.Context(), root, staging, sum, hashes, version); err != nil {
		t.Fatal(err)
	}
	return sum, hashes
}

func TestConsecutiveActivationsPreserveRunningSuite(t *testing.T) {
	root := t.TempDir()
	files := runtimeFixture("v1.2.1")
	files["LICENSE"] = []byte("original running suite resource\n")
	files["redeven"] = []byte("#!/bin/sh\nif [ \"$1\" = version ]; then printf 'redeven v1.2.1 (fixture) test\\n'; exit 0; fi\nIFS= read -r signal\nwhile IFS= read -r line; do printf '%s\\n' \"$line\"; done < \"${0%/*}/REDEVEN_LICENSE\"\n")
	first, hashes := stageFixture(t, root, "v1.2.1", files)
	if err := activateSuite(t.Context(), root, first, activation{}, hashes, "v1.2.1"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, filepath.Join(root, suiteDirectory, first, "redeven"), "read-resource")
	command.WaitDelay = time.Second
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	})
	for _, version := range []string{"v1.2.2", "v1.2.3"} {
		previous, err := inspectActivation(root)
		if err != nil {
			t.Fatal(err)
		}
		next, nextHashes := stageFixture(t, root, version, runtimeFixture(version))
		if err := activateSuite(t.Context(), root, next, previous, nextHashes, version); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := io.WriteString(input, "continue\n"); err != nil {
		t.Fatal(err)
	}
	if err := input.Close(); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err != nil {
		t.Fatalf("an older running Runtime lost its complete suite after consecutive installations: %v: %s", err, output.String())
	}
	if output.String() != string(files["LICENSE"]) {
		t.Fatalf("running suite resource changed: %q", output.String())
	}
}

func TestSuiteActivationRetentionAndConcurrentChange(t *testing.T) {
	root := t.TempDir()
	old, oldHashes := stageFixture(t, root, "v1.2.2", runtimeFixture("v1.2.2"))
	if err := activateSuite(t.Context(), root, old, activation{}, oldHashes, "v1.2.2"); err != nil {
		t.Fatal(err)
	}
	previous, err := inspectActivation(root)
	if err != nil {
		t.Fatal(err)
	}
	next, hashes := stageFixture(t, root, "v1.2.3", runtimeFixture("v1.2.3"))
	if err := activateSuite(t.Context(), root, next, previous, hashes, "v1.2.3"); err != nil {
		t.Fatal(err)
	}
	for _, sum := range []string{old, next} {
		if _, err := os.Stat(filepath.Join(root, suiteDirectory, sum)); err != nil {
			t.Fatal("previous or active complete suite was removed:", err)
		}
	}
	if err := activateSuite(t.Context(), root, next, previous, hashes, "v1.2.3"); err == nil {
		t.Fatal("stale activation snapshot was accepted")
	}
}

func TestActivationRestoresPreviousLinkAfterFailedFinalCheck(t *testing.T) {
	root := t.TempDir()
	old, oldHashes := stageFixture(t, root, "v1.2.2", runtimeFixture("v1.2.2"))
	if err := activateSuite(t.Context(), root, old, activation{}, oldHashes, "v1.2.2"); err != nil {
		t.Fatal(err)
	}
	previous, err := inspectActivation(root)
	if err != nil {
		t.Fatal(err)
	}
	previous.version = "v1.2.2"
	files := runtimeFixture("v1.2.3")
	files["redeven"] = []byte("#!/bin/sh\nif [ \"$0\" = " + shellQuote(filepath.Join(root, "redeven")) + " ]; then exit 7; fi\nprintf 'redeven v1.2.3 (fixture) test\\n'\n")
	next, hashes := stageFixture(t, root, "v1.2.3", files)
	err = activateSuite(t.Context(), root, next, previous, hashes, "v1.2.3")
	if err == nil || !strings.Contains(err.Error(), "previous activation was restored") {
		t.Fatalf("expected a confirmed restoration, got %v", err)
	}
	observed, err := executableVersion(t.Context(), filepath.Join(root, "redeven"))
	if err != nil || observed != "v1.2.2" {
		t.Fatalf("old runtime was not restored: %s %v", observed, err)
	}
}

func TestInstallLockRejectsConcurrentInstaller(t *testing.T) {
	root := t.TempDir()
	unlock, err := lockInstallation(root)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if release, err := lockInstallation(root); err == nil {
		release()
		t.Fatal("concurrent installer acquired the same activation root")
	}
}

func TestPathConfigurationIsIdempotentAndShellSpecific(t *testing.T) {
	for _, shell := range []string{"bash", "zsh", "fish"} {
		t.Run(shell, func(t *testing.T) {
			config, err := (Config{Home: t.TempDir(), Shell: "/bin/" + shell, Output: io.Discard}).normalized()
			if err != nil {
				t.Fatal(err)
			}
			if err := configurePath(config); err != nil {
				t.Fatal(err)
			}
			if err := configurePath(config); err != nil {
				t.Fatal(err)
			}
			name, _ := pathInstruction(config)
			contents, err := os.ReadFile(name)
			if err != nil || bytes.Count(contents, []byte(pathBlockStart)) != 1 {
				t.Fatal("PATH block is not idempotent:", err)
			}
			if shell == "fish" && (bytes.Contains(contents, []byte("export PATH")) || !bytes.Contains(contents, []byte("set -gx PATH"))) {
				t.Fatal("fish configuration uses POSIX syntax")
			}
			config.Mode = "upgrade"
			if err := configurePath(config); err != nil {
				t.Fatal(err)
			}
			after, _ := os.ReadFile(name)
			if !bytes.Equal(contents, after) {
				t.Fatal("upgrade changed shell configuration")
			}
		})
	}
}

func fixtureServer(t *testing.T, archive []byte, digest string) (*downloader, releaseSource, *atomic.Int32) {
	t.Helper()
	platform, err := hostPlatform()
	if err != nil {
		t.Fatal(err)
	}
	packageName := "redeven_" + platform + ".tar.gz"
	contract, err := os.ReadFile("distribution_contract.json")
	if err != nil {
		t.Fatal(err)
	}
	contractHash := sha256.Sum256(contract)
	archiveRequests := new(atomic.Int32)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch filepath.Base(r.URL.Path) {
		case "metadata":
			fmt.Fprint(w, `{"tag_name":"v1.2.3"}`)
		case "SHA256SUMS":
			fmt.Fprintf(w, "%s  %s\n", digest, packageName)
			fmt.Fprintf(w, "%x  %s\n", contractHash, distributionAsset)
		case distributionAsset:
			w.Write(contract)
		case "SHA256SUMS.sig", "SHA256SUMS.pem":
			fmt.Fprint(w, "controller fixture, not cryptographic evidence")
		case packageName:
			archiveRequests.Add(1)
			w.Header().Set("Content-Length", fmt.Sprint(len(archive)))
			if r.Method != http.MethodHead {
				w.Write(archive)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return &downloader{client: server.Client(), cache: filepath.Join(t.TempDir(), "cache"), output: io.Discard}, releaseSource{versionURL: server.URL + "/metadata", githubURL: server.URL + "/releases"}, archiveRequests
}

func TestInstallerVerifiesBeforeDownloadingAndKeepsExistingRuntime(t *testing.T) {
	data, digest := tarFixture(t, runtimeFixture("v1.2.3"))
	download, source, requests := fixtureServer(t, data, digest)
	config, err := (Config{Home: t.TempDir(), Output: io.Discard}).normalized()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(config.InstallDir, 0755); err != nil {
		t.Fatal(err)
	}
	old := []byte("#!/bin/sh\nprintf 'redeven v1.2.2 (old) test\\n'\n")
	name := filepath.Join(config.InstallDir, "redeven")
	if err := os.WriteFile(name, old, 0755); err != nil {
		t.Fatal(err)
	}
	err = run(t.Context(), config, runDependencies{source: source, client: download,
		verify:  func(context.Context, []byte, []byte, []byte, string) error { return errors.New("signature rejected") },
		prepare: func(context.Context, *downloader, Config, string, string) error { return nil },
	})
	if err == nil || requests.Load() != 0 {
		t.Fatal("payload was acquired before publisher verification")
	}
	after, _ := os.ReadFile(name)
	if !bytes.Equal(after, old) {
		t.Fatal("failed verification changed the existing runtime")
	}
}

func TestInstallerFullControllerTransactionWithoutDeveloperTools(t *testing.T) {
	data, digest := tarFixture(t, runtimeFixture("v1.2.3"))
	download, source, _ := fixtureServer(t, data, digest)
	config, err := (Config{InstallerVersion: "v0.13.13", Home: t.TempDir(), Output: io.Discard, Mode: "upgrade"}).normalized()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(config.InstallDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(config.InstallDir, "redeven"), runtimeFixture("v1.2.2")["redeven"], 0755); err != nil {
		t.Fatal(err)
	}
	legacy := map[string][]byte{}
	for _, role := range runtimeFiles {
		if role.name == "redeven" || role.name == "computer.zip" {
			continue
		}
		legacy[role.name] = []byte("still-used legacy resource: " + role.name)
		if err := os.WriteFile(filepath.Join(config.InstallDir, role.name), legacy[role.name], role.mode); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", "/usr/bin:/bin")
	// This test isolates the install controller. Real signature verification is
	// independently exercised against immutable official release materials.
	err = run(t.Context(), config, runDependencies{source: source, client: download,
		verify:  func(context.Context, []byte, []byte, []byte, string) error { return nil },
		prepare: func(context.Context, *downloader, Config, string, string) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	version, err := executableVersion(t.Context(), filepath.Join(config.InstallDir, "redeven"))
	if err != nil || version != "v1.2.3" {
		t.Fatal("final activation is not the requested runtime:", version, err)
	}
	for _, source := range runtimeFiles {
		if _, err := os.Stat(filepath.Join(config.InstallDir, suiteDirectory, digest, source.name)); err != nil {
			t.Fatal("installed suite lost a component:", err)
		}
	}
	for name, expected := range legacy {
		actual, err := os.ReadFile(filepath.Join(config.InstallDir, name))
		if err != nil || !bytes.Equal(actual, expected) {
			t.Fatalf("migration changed legacy resources that an older process can still use: %s: %v", name, err)
		}
	}
}
