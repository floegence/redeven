package managedwebservice

import (
	"encoding/json"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestAuditedNativeCatalogPinsEverySupportedPlatform(t *testing.T) {
	t.Parallel()
	catalog := auditedNativeCatalog()
	if catalog.TemplateID != DeepSeekHarnessTemplateID || catalog.Version != DeepSeekHarnessVersion || len(catalog.Platforms) != 4 {
		t.Fatalf("audited native catalog = %+v", catalog)
	}
	for _, platform := range []string{"darwin-arm64", "darwin-amd64", "linux-arm64", "linux-amd64"} {
		artifact, ok := catalog.Platforms[platform]
		if !ok {
			t.Fatalf("audited native catalog is missing %s", platform)
		}
		if err := validateNativeArtifact(artifact, http.DefaultClient, defaultNodePackageOrigin); err != nil {
			t.Fatalf("validate %s native runtime: %v", platform, err)
		}
		if !strings.Contains(artifact.DownloadURL, "node-v24.19.0-") || artifact.ExecutableRelPath != "bin/dsh" {
			t.Fatalf("audited %s native artifact = %+v", platform, artifact)
		}
	}
	if _, ok := auditedNativeArtifact("windows-amd64"); ok {
		t.Fatal("Windows must not receive a built-in native runtime")
	}
}

func TestValidateNativeArtifactRejectsUntrustedSourceAndUnsafeLayout(t *testing.T) {
	t.Parallel()
	valid, ok := auditedNativeArtifact("darwin-arm64")
	if !ok {
		t.Fatal("missing test artifact")
	}
	if err := validateNativeArtifact(valid, http.DefaultClient, defaultNodePackageOrigin); err != nil {
		t.Fatalf("valid native artifact: %v", err)
	}
	untrusted := valid
	untrusted.DownloadURL = "https://example.com/node.tar.gz"
	if err := validateNativeArtifact(untrusted, http.DefaultClient, defaultNodePackageOrigin); managedErrorCode(err) != "PACKAGE_SOURCE_REJECTED" {
		t.Fatalf("untrusted package error = %v", err)
	}
	unsafe := valid
	unsafe.NodeRelPath = "../node"
	if err := validateNativeArtifact(unsafe, http.DefaultClient, defaultNodePackageOrigin); managedErrorCode(err) != "CATALOG_INVALID" {
		t.Fatalf("unsafe package layout error = %v", err)
	}
}

func TestEmbeddedNativePackageIsReleaseLocked(t *testing.T) {
	t.Parallel()
	if err := validateEmbeddedNativePackage(); err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		PackageManager string            `json:"packageManager"`
		AllowScripts   map[string]bool   `json:"allowScripts"`
		Dependencies   map[string]string `json:"dependencies"`
	}
	if err := json.Unmarshal(nativePackageJSON, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.PackageManager != "npm@11.17.0" || manifest.Dependencies["@deepseek-ai/dsh"] != DeepSeekHarnessVersion {
		t.Fatalf("native package manifest = %+v", manifest)
	}
	var lock struct {
		Name     string `json:"name"`
		Version  string `json:"version"`
		Packages map[string]struct {
			Version          string `json:"version"`
			Resolved         string `json:"resolved"`
			Integrity        string `json:"integrity"`
			HasInstallScript bool   `json:"hasInstallScript"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(nativePackageLock, &lock); err != nil {
		t.Fatal(err)
	}
	if lock.Name != "@redeven/managed-deepseek-harness-runtime" || lock.Version != DeepSeekHarnessVersion {
		t.Fatalf("native package lock identity = %s@%s", lock.Name, lock.Version)
	}
	dsh := lock.Packages["node_modules/@deepseek-ai/dsh"]
	if dsh.Version != DeepSeekHarnessVersion || dsh.Integrity != "sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==" {
		t.Fatalf("locked DeepSeek Harness package = %+v", dsh)
	}
	installScripts := make([]string, 0, 5)
	for path, pkg := range lock.Packages {
		if path == "" {
			continue
		}
		if !strings.HasPrefix(pkg.Resolved, "https://registry.npmjs.org/") || pkg.Integrity == "" {
			t.Fatalf("package %s is not registry- and integrity-locked: %+v", path, pkg)
		}
		if pkg.HasInstallScript {
			index := strings.LastIndex(path, "node_modules/")
			installScripts = append(installScripts, path[index+len("node_modules/"):])
		}
	}
	sort.Strings(installScripts)
	wantInstallScripts := []string{"@deepseek-ai/dsh-subprocess-local", "@google/genai", "koffi", "node-pty", "protobufjs"}
	if !reflect.DeepEqual(installScripts, wantInstallScripts) {
		t.Fatalf("locked install scripts = %v, want %v", installScripts, wantInstallScripts)
	}
	approvedScripts := make([]string, 0, len(manifest.AllowScripts))
	for name, approved := range manifest.AllowScripts {
		if !approved {
			t.Fatalf("install script %s is explicitly denied instead of omitted", name)
		}
		approvedScripts = append(approvedScripts, name)
	}
	sort.Strings(approvedScripts)
	if !reflect.DeepEqual(approvedScripts, wantInstallScripts) {
		t.Fatalf("approved install scripts = %v, want %v", approvedScripts, wantInstallScripts)
	}
}
