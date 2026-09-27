//go:build linux && browser_system_acceptance

package browserinstall

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This explicit acceptance lane must run on the target as root. It never
// changes the real browser installation or loads policies into the kernel.
func TestSystemPreparationPrivilegedTransactions(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Fatal("browser system acceptance requires target system authorization")
	}
	for _, mode := range []string{"success", "invalid_archive", "cancel", "policy_failure", "resume_publication"} {
		t.Run(mode, func(t *testing.T) {
			root, err := os.MkdirTemp("/opt", "redeven-system-acceptance-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(root)
			store, policies := filepath.Join(root, "packages"), filepath.Join(root, "policies")
			if err = os.Mkdir(policies, 0755); err != nil {
				t.Fatal(err)
			}
			if err = os.Mkdir(store, 0755); err != nil {
				t.Fatal(err)
			}
			old := filepath.Join(store, "previous-version")
			if err = os.WriteFile(old, []byte("preserve"), 0644); err != nil {
				t.Fatal(err)
			}
			data, pkg := fixture(t, "browser/chrome")
			if mode == "invalid_archive" {
				data = bytes.Repeat([]byte{'x'}, len(data))
			}
			reader, writer := io.Pipe()
			defer reader.Close()
			defer writer.Close()
			go func() { _, _ = writer.Write(data) }()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			var phases bytes.Buffer
			load := func(_ context.Context, remove bool, path string) error {
				if remove {
					return nil
				}
				body, err := os.ReadFile(path)
				if err != nil {
					return err
				}
				if strings.Contains(string(body), "*") {
					t.Fatal("broad executable policy")
				}
				if mode == "policy_failure" {
					return errors.New("fixture policy failure")
				}
				if mode == "cancel" {
					cancel()
				}
				return nil
			}
			err = installSystemBrowser(ctx, pkg, reader, &phases, store, policies, load)
			final := filepath.Join(store, pkg.SHA256)
			switch mode {
			case "success", "resume_publication":
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(phases.String(), `"phase":"ready"`) {
					t.Fatal("missing commit acknowledgement")
				}
				for _, file := range []string{filepath.Join(final, pkg.Executable), filepath.Join(final, ".ready"), filepath.Join(policies, "redeven-browser-"+pkg.SHA256)} {
					if !trustedSystemPath(file) {
						t.Fatal("published writable system path", file)
					}
				}
				if mode == "resume_publication" {
					if err = os.Remove(filepath.Join(final, ".ready")); err != nil {
						t.Fatal(err)
					}
					retryReader, retryWriter := io.Pipe()
					defer retryReader.Close()
					defer retryWriter.Close()
					go func() { _, _ = retryWriter.Write(data) }()
					if err = installSystemBrowser(t.Context(), pkg, retryReader, io.Discard, store, policies, load); err != nil {
						t.Fatal("interrupted publication was not recoverable", err)
					}
				}
			default:
				if err == nil {
					t.Fatal("accepted incomplete preparation")
				}
				if _, err = os.Stat(final); !os.IsNotExist(err) {
					t.Fatal("failed preparation retained partial package", err)
				}
				entries, err := os.ReadDir(policies)
				if err != nil || len(entries) != 0 {
					t.Fatal("failed preparation retained policy", entries, err)
				}
			}
			body, err := os.ReadFile(old)
			if err != nil || string(body) != "preserve" {
				t.Fatal("previous version changed")
			}
			entries, err := os.ReadDir(store)
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range entries {
				if strings.HasPrefix(entry.Name(), ".prepare-") {
					t.Fatal("staging directory leaked")
				}
			}
		})
	}
}
