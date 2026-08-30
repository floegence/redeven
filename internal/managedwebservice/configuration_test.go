package managedwebservice

import (
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func configuredServiceForTest(t *testing.T, spec TemplateSpec, configuration serviceConfiguration, source string) *pfregistry.ManagedService {
	t.Helper()
	snapshot, snapshotDigest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	encoded, configurationDigest, err := canonicalServiceConfiguration(configuration)
	if err != nil {
		t.Fatal(err)
	}
	return &pfregistry.ManagedService{
		ServiceID: "mws_config", TemplateID: "template", TemplateSource: source, TemplateRevision: 1,
		TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: snapshotDigest, ServiceFamilyID: "family",
		Deployment: string(spec.Kind), ConfigurationJSON: encoded, ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
	}
}

func TestEffectiveSpecAppliesOneTypedInstanceOverride(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer,
		Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3000},
		Container: &ContainerTemplateSpec{
			Image: "example.invalid/app@sha256:" + strings.Repeat("a", 64), ReadOnlyRoot: true,
			Mounts: []ContainerMountSpec{{ResourceID: "data", Type: "volume", Source: "data", Target: "/data"}},
		},
	}
	command := []string{"serve", "--port", "3000"}
	environment := map[string]string{"LOG_LEVEL": "debug"}
	cpus := 1.5
	configuration := newServiceConfiguration(nil, nil)
	configuration.Container = &containerSettingsOverride{Command: &command, Environment: &environment, CPUs: &cpus}
	service := configuredServiceForTest(t, spec, configuration, "custom")

	effective, decoded, err := effectiveSpecFromService(service)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(effective.Container.Command, " ") != "serve --port 3000" || effective.Container.Environment["LOG_LEVEL"] != "debug" || effective.Container.CPUs != 1.5 {
		t.Fatalf("effective container = %+v", effective.Container)
	}
	if effective.Container.PIDsLimit != 512 || !effective.Container.ReadOnlyRoot || !sameStrings(effective.Container.CapDrop, []string{"ALL"}) {
		t.Fatalf("normalized security defaults = %+v", effective.Container)
	}
	if decoded.Container == nil || decoded.Container.CPUs == nil {
		t.Fatalf("decoded override = %+v", decoded)
	}
}

func TestComposeEffectiveSpecNormalizesEveryServiceWithoutAnOverride(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentCompose,
		Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3000},
		Compose:  &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: example.invalid/app@sha256:" + strings.Repeat("b", 64) + "\n    volumes:\n      - data:/data\n"},
	}
	service := configuredServiceForTest(t, spec, newServiceConfiguration(nil, nil), "custom")
	effective, _, err := effectiveSpecFromService(service)
	if err != nil {
		t.Fatal(err)
	}
	settings, err := composeBaselineSettings(effective)
	if err != nil {
		t.Fatal(err)
	}
	web := settings["web"]
	if !web.ReadOnlyRoot || web.PIDsLimit != 512 || !sameStrings(web.CapDrop, []string{"ALL"}) || !sameStrings(web.SecurityOpts, []string{"no-new-privileges:true"}) {
		t.Fatalf("normalized Compose service = %+v", web)
	}
	if len(web.Mounts) != 1 || web.Mounts[0].ResourceID == "" || web.Mounts[0].Type != "volume" {
		t.Fatalf("Compose mount identity = %+v", web.Mounts)
	}
}

func TestReconfigureRisksOnlyReportNewCapabilities(t *testing.T) {
	t.Parallel()
	baseline := TemplateSpec{Container: &ContainerTemplateSpec{ReadOnlyRoot: true, CapDrop: []string{"ALL"}, SecurityOpts: []string{"no-new-privileges:true"}}}
	unchanged := baseline
	if risks := reconfigureRisks(baseline, unchanged, "builtin"); len(risks) != 0 {
		t.Fatalf("unchanged reviewed settings reported risks: %+v", risks)
	}
	weakened := baseline
	copy := *baseline.Container
	copy.ReadOnlyRoot = false
	copy.Privileged = true
	weakened.Container = &copy
	risks := reconfigureRisks(baseline, weakened, "builtin")
	if len(risks) != 2 || risks[0].ID != "privileged" || risks[1].ID != "weakened-security" {
		t.Fatalf("new risks = %+v", risks)
	}
}

func TestReconfigureAuthorizationBindsPlanRisksAndAdministrator(t *testing.T) {
	t.Parallel()
	candidate := reconfigureCandidate{Plan: ReconfigurePlan{PlanDigest: "current-plan", Risks: []RiskNotice{{ID: "privileged", RequiresAdmin: true}}}}
	tests := []struct {
		name    string
		request ReconfigureRequest
		code    string
	}{
		{name: "stale plan", request: ReconfigureRequest{PlanDigest: "old-plan"}, code: "RESOURCE_PLAN_STALE"},
		{name: "risk missing", request: ReconfigureRequest{PlanDigest: "current-plan", Administrator: true}, code: "RISK_ACKNOWLEDGEMENT_REQUIRED"},
		{name: "admin missing", request: ReconfigureRequest{PlanDigest: "current-plan", AcceptedRiskIDs: []string{"privileged"}}, code: "ADMIN_REQUIRED"},
	}
	for _, testCase := range tests {
		if err := validateReconfigureAuthorization(candidate, testCase.request); managedErrorCode(err) != testCase.code {
			t.Fatalf("%s error = %v", testCase.name, err)
		}
	}
	if err := validateReconfigureAuthorization(candidate, ReconfigureRequest{PlanDigest: "current-plan", AcceptedRiskIDs: []string{"privileged"}, Administrator: true}); err != nil {
		t.Fatal(err)
	}
}

func TestManagedAnchorsRejectReservedLabelsAndVolumeRetargeting(t *testing.T) {
	t.Parallel()
	baseline := ContainerTemplateSpec{Mounts: []ContainerMountSpec{{ResourceID: "data", Type: "volume", Source: "data", Target: "/data"}}}
	desired := containerRuntimeSettingsFromSpec(baseline, nil)
	desired.Labels = map[string]string{"io.redeven.owner": "other"}
	if err := validateManagedAnchors(baseline, desired); managedErrorCode(err) != "RESERVED_LABEL_LOCKED" {
		t.Fatalf("reserved label error = %v", err)
	}
	desired.Labels = nil
	desired.Mounts[0].Target = "/other"
	if err := validateManagedAnchors(baseline, desired); managedErrorCode(err) != "MANAGED_DATA_ANCHOR_LOCKED" {
		t.Fatalf("volume retarget error = %v", err)
	}
}

func TestSecretEnvironmentNormalizationNeverPersistsAValue(t *testing.T) {
	t.Parallel()
	plain, secrets, names, err := normalizeEnvironmentSettings([]EnvironmentSetting{{Name: "TOKEN", Value: "private", Secret: true}, {Name: "MODE", Value: "safe"}})
	if err != nil {
		t.Fatal(err)
	}
	if plain["TOKEN"] != "" || secrets["TOKEN"] != "private" || len(names) != 1 || names[0] != "TOKEN" || plain["MODE"] != "safe" {
		t.Fatalf("plain=%v secrets=%v names=%v", plain, secrets, names)
	}
}

func TestContainerSettingsRejectMalformedTypedResources(t *testing.T) {
	t.Parallel()
	tests := []ContainerTemplateSpec{
		{ReadOnlyRoot: true, RestartPolicy: "sometimes"},
		{ReadOnlyRoot: true, Environment: map[string]string{"bad-name": "value"}},
		{ReadOnlyRoot: true, Mounts: []ContainerMountSpec{{ResourceID: "mount", Type: "bind", Source: "relative", Target: "/data"}}},
		{ReadOnlyRoot: true, Ports: []ContainerPortSpec{{ResourceID: "port", ContainerPort: 3000, HostIP: "not-an-ip"}}},
		{ReadOnlyRoot: true, Devices: []ContainerDeviceSpec{{ResourceID: "device", HostPath: "/dev/kvm", Permissions: "rr"}}},
	}
	for index, spec := range tests {
		if err := validateContainerRuntimeSettings(spec); err == nil {
			t.Fatalf("case %d accepted invalid settings: %+v", index, spec)
		}
	}
}

func TestComposeRuntimeIdentityMatchesNamedVolumesAndDevicesExactly(t *testing.T) {
	t.Parallel()
	mounts := []containerengine.MountSummary{{Type: containerengine.MountTypeVolume, Source: "redeven-project_data", Target: "/data"}}
	if !composeMountsMatch(mounts, []ContainerMountSpec{{ResourceID: "data", Type: "volume", Source: "data", Target: "/data"}}, "redeven-project") {
		t.Fatal("expected project-scoped named volume to match")
	}
	if composeMountsMatch(mounts, []ContainerMountSpec{{ResourceID: "data", Type: "volume", Source: "other", Target: "/data"}}, "redeven-project") {
		t.Fatal("different named volume must not match")
	}
	devices := []containerengine.DeviceSummary{{HostPath: "/dev/kvm", ContainerPath: "/dev/kvm", Permissions: "rwm"}}
	if !composeDevicesMatch(devices, []ContainerDeviceSpec{{ResourceID: "kvm", HostPath: "/dev/kvm"}}) {
		t.Fatal("default device target and permissions should match")
	}
}
