package redevpluginintegration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
)

func TestLoadDevelopmentDeliveryUsesSignedProductionContract(t *testing.T) {
	descriptorPath := writeDevelopmentDeliveryFixture(t, nil)
	delivery, err := loadDevelopmentDelivery(descriptorPath)
	if err != nil {
		t.Fatalf("loadDevelopmentDelivery() error = %v", err)
	}
	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	if delivery.contract.Pin != bundle.Pin {
		t.Fatalf("development pin = %#v, want signed production pin %#v", delivery.contract.Pin, bundle.Pin)
	}
	_, bridge, err := newContainersCapabilityRegistry(mustContainersAdapter(t, &capabilityEngineClient{}), nil, delivery)
	if err != nil {
		t.Fatalf("newContainersCapabilityRegistry() error = %v", err)
	}
	t.Cleanup(func() { _ = bridge.Close() })
}

func TestLoadDevelopmentDeliveryRejectsNonProductionContractPin(t *testing.T) {
	descriptorPath := writeDevelopmentDeliveryFixture(t, func(manifest map[string]any) {
		bindings := manifest["capability_bindings"].([]any)
		binding := bindings[0].(map[string]any)
		pin := binding["contract"].(map[string]any)
		pin["signature_key_id"] = "redeven-containers-v4-development"
	})
	_, err := loadDevelopmentDelivery(descriptorPath)
	if err == nil || !strings.Contains(err.Error(), "signed production contract") {
		t.Fatalf("loadDevelopmentDelivery() error = %v, want signed production contract rejection", err)
	}
}

func writeDevelopmentDeliveryFixture(t *testing.T, mutateManifest func(map[string]any)) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "containers-4.0.1.unsigned.redevplugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := pluginpkg.Read(context.Background(), bytes.NewReader(raw), int64(len(raw)), pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(pkg.Files["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["schema_version"] = "redevplugin.manifest.v8"
	manifest["presentation"] = map[string]any{
		"default_locale": "en-US", "summary": "Containers development package.",
		"description": []string{"Containers development package."}, "highlights": []string{"Development package"},
		"keywords": []string{"containers"}, "localizations": []any{},
	}
	plugin := manifest["plugin"].(map[string]any)
	plugin["version"] = "4.0.0"
	plugin["ui_protocol_version"] = "plugin-ui-v7"
	if mutateManifest != nil {
		mutateManifest(manifest)
	}
	manifestRaw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Files["manifest.json"] = manifestRaw
	if err := json.Unmarshal(manifestRaw, &pkg.Manifest); err != nil {
		t.Fatal(err)
	}
	pkg.PackageHash = ""
	pkg.ManifestHash = ""
	pkg.EntriesHash = ""
	pkg.PackageSignature = nil
	pkg.SignatureFiles = nil

	var packageBuffer bytes.Buffer
	if err := pluginpkg.WritePackage(context.Background(), &packageBuffer, pkg); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	packagePath := filepath.Join(root, "containers-4.0.0.redevplugin")
	if err := os.WriteFile(packagePath, packageBuffer.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(packageBuffer.Bytes())
	descriptor := map[string]any{
		"schema_version":               "redeven.plugin_development_delivery.v3",
		"plugin_instance_id":           officialContainersPluginInstanceID,
		"publisher_id":                 officialPublisherID,
		"plugin_id":                    officialContainersPluginID,
		"version":                      "4.0.0",
		"package_path":                 packagePath,
		"package_sha256":               hex.EncodeToString(digest[:]),
		"release_notes_id":             officialContainersReleaseNotesID,
		"release_notes_summary_sha256": strings.Repeat("a", 64),
		"source_repository":            officialContainersSourceRepository,
		"source_commit":                officialContainersSourceCommit,
	}
	descriptorRaw, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	descriptorPath := filepath.Join(root, "delivery.json")
	if err := os.WriteFile(descriptorPath, descriptorRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	return descriptorPath
}
