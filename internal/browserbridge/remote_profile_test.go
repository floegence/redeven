package browserbridge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func remoteProfileFixture(t *testing.T) (string, Installation, string) {
	t.Helper()
	root := t.TempDir()
	installation := Installation{ID: "browser-fixture", Kind: "chromium_snap", Name: "Chromium (Snap)", Installed: true,
		Executable: "/snap/bin/chromium", PrivateRoot: filepath.Join(root, "snap-common"), ManifestDirectory: filepath.Join(root, "manifests")}
	if err := os.MkdirAll(installation.ManifestDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	host := "dev.floegence.redeven.r123456789abcdef0"
	manifest, _ := json.Marshal(map[string]any{"name": host, "path": filepath.Join(root, "bridge"), "type": "stdio", "allowed_origins": []string{"chrome-extension://" + ExtensionID + "/"}})
	if err := os.WriteFile(filepath.Join(installation.ManifestDirectory, host+".json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(root, "runtime"), installation, host
}

func TestRemoteBrowserProfileHasStableOwnerAndEnvironmentIdentity(t *testing.T) {
	state, installation, host := remoteProfileFixture(t)
	first, err := PrepareRemoteProfile(state, "alice", installation, host)
	if err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(first.Directory, "login-state-fixture")
	if err := os.WriteFile(data, []byte("preserve this browser's data"), 0600); err != nil {
		t.Fatal(err)
	}
	again, err := PrepareRemoteProfile(state, "alice", installation, host)
	if err != nil || !reflect.DeepEqual(first, again) {
		t.Fatalf("unstable profile: %+v %v", again, err)
	}
	if b, err := os.ReadFile(data); err != nil || string(b) != "preserve this browser's data" {
		t.Fatalf("profile data changed: %s %v", b, err)
	}
	for _, pair := range [][2]string{{state, "bob"}, {state + "-other", "alice"}} {
		other, err := PrepareRemoteProfile(pair[0], pair[1], installation, host)
		if err != nil || other.ID == first.ID || other.Directory == first.Directory {
			t.Fatalf("profile authority was shared: %+v %v", other, err)
		}
	}
	if !strings.HasPrefix(first.Directory, installation.PrivateRoot+string(os.PathSeparator)) {
		t.Fatal("Snap profile escaped its accessible data area")
	}
	for _, path := range []string{first.Directory, filepath.Join(first.Directory, "NativeMessagingHosts")} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0700 {
			t.Fatalf("profile directory is not private: %s %v", path, err)
		}
	}
	if got := first.Arguments; len(got) != 5 || got[0] != "--user-data-dir="+first.Directory || got[1] != "--ozone-platform=x11" || got[4] != "chrome://extensions/" {
		t.Fatalf("unexpected launch arguments: %v", got)
	}
}

func TestRemoteBrowserProfileRejectsLinkedStateWithoutChangingDestination(t *testing.T) {
	state, installation, host := remoteProfileFixture(t)
	first, err := PrepareRemoteProfile(state, "alice", installation, host)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(first.Directory); err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()
	if err := os.Symlink(other, first.Directory); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareRemoteProfile(state, "alice", installation, host); err == nil {
		t.Fatal("linked browser profile was accepted")
	}
	entries, _ := os.ReadDir(other)
	if len(entries) != 0 {
		t.Fatal("linked destination was modified")
	}
}

func TestRemoteBrowserProfileValidatesNativeHostBeforeCreatingState(t *testing.T) {
	for _, scenario := range []string{"invalid-host", "foreign-origin", "linked-manifest", "oversized-manifest", "absent-browser", "missing-owner"} {
		t.Run(scenario, func(t *testing.T) {
			state, installation, host := remoteProfileFixture(t)
			owner := "alice"
			manifest := filepath.Join(installation.ManifestDirectory, host+".json")
			switch scenario {
			case "invalid-host":
				host = "../outside"
			case "foreign-origin":
				if err := os.WriteFile(manifest, []byte(`{"name":"`+host+`","path":"/bridge","type":"stdio","allowed_origins":["chrome-extension://foreign/"]}`), 0600); err != nil {
					t.Fatal(err)
				}
			case "linked-manifest":
				if err := os.Rename(manifest, manifest+".outside"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(manifest+".outside", manifest); err != nil {
					t.Fatal(err)
				}
			case "oversized-manifest":
				if err := os.WriteFile(manifest, []byte(strings.Repeat(" ", 65537)), 0600); err != nil {
					t.Fatal(err)
				}
			case "absent-browser":
				installation.Installed = false
			case "missing-owner":
				owner = ""
			}
			if _, err := PrepareRemoteProfile(state, owner, installation, host); err == nil {
				t.Fatal("invalid remote browser preparation was accepted")
			}
			if _, err := os.Stat(installation.PrivateRoot); !os.IsNotExist(err) {
				t.Fatal("invalid preparation created profile state")
			}
		})
	}
}

func TestRemoteBrowserNativeProfileNeverUsesPersonalData(t *testing.T) {
	for _, kind := range []string{"google_chrome", "chromium"} {
		t.Run(kind, func(t *testing.T) {
			state, installation, host := remoteProfileFixture(t)
			installation.Kind = kind
			installation.Executable = "/usr/bin/" + kind
			installation.PrivateRoot = ""
			personal := filepath.Join(installation.ManifestDirectory, "..", "Default")
			if err := os.Mkdir(personal, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(personal, "Cookies"), []byte("personal data"), 0600); err != nil {
				t.Fatal(err)
			}
			profile, err := PrepareRemoteProfile(state, "alice", installation, host)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(profile.Directory, state+string(os.PathSeparator)) {
				t.Fatal("native remote profile is outside Runtime state")
			}
			if _, err := os.Stat(filepath.Join(profile.Directory, "Default")); !os.IsNotExist(err) {
				t.Fatal("preparation copied a personal profile")
			}
			if contents, err := os.ReadFile(filepath.Join(personal, "Cookies")); err != nil || string(contents) != "personal data" {
				t.Fatal("preparation modified the personal profile")
			}
			if err := os.Chmod(profile.Directory, 0755); err != nil {
				t.Fatal(err)
			}
			if _, err := PrepareRemoteProfile(state, "alice", installation, host); err == nil {
				t.Fatal("preparation accepted a publicly readable profile")
			}
		})
	}
}

func TestRemoteBrowserRegistrationFollowsRuntimeReplacement(t *testing.T) {
	state, installation, host := remoteProfileFixture(t)
	profile, err := PrepareRemoteProfile(state, "alice", installation, host)
	if err != nil {
		t.Fatal(err)
	}
	canonical := filepath.Join(installation.ManifestDirectory, host+".json")
	registration := filepath.Join(profile.Directory, "NativeMessagingHosts", host+".json")
	original, err := os.ReadFile(registration)
	if err != nil {
		t.Fatal(err)
	}
	updated := strings.Replace(string(original), `"path":"`, `"path":"/next-generation`, 1)
	if updated == string(original) {
		t.Fatal("fixture did not change the bridge endpoint")
	}
	if err := os.WriteFile(canonical+".next", []byte(updated), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(canonical+".next", canonical); err != nil {
		t.Fatal(err)
	}
	if actual, err := os.ReadFile(registration); err != nil || string(actual) != updated {
		t.Fatalf("profile retained a retired Runtime registration: %s %v", actual, err)
	}
	if err := os.Remove(canonical); err != nil {
		t.Fatal(err)
	}
	if _, err := os.ReadFile(registration); !os.IsNotExist(err) {
		t.Fatal("stopped Runtime registration is still available")
	}
}

func TestRemoteBrowserProfileRejectsWritablePlacement(t *testing.T) {
	for _, parent := range []bool{false, true} {
		state, installation, host := remoteProfileFixture(t)
		placement := installation.PrivateRoot
		if parent {
			placement = filepath.Join(placement, "Redeven")
		}
		if err := os.MkdirAll(placement, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(placement, 0777); err != nil {
			t.Fatal(err)
		}
		if _, err := PrepareRemoteProfile(state, "alice", installation, host); err == nil {
			t.Fatal("other OS users can replace the prepared profile directory")
		}
	}
}
