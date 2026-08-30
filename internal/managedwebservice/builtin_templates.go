package managedwebservice

import (
	"context"
	"path/filepath"
	"runtime"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	webtopImage     = "lscr.io/linuxserver/webtop"
	webtopSourceURL = "https://github.com/linuxserver/docker-webtop"

	webtopUbuntuKDEVersion  = "654ea8e3-ls177"
	webtopDebianXFCEVersion = "7c4ebdc9-ls209"

	webtopRootNoticeID = "interactive-desktop-root-and-network"
)

type builtInTemplateDefinition struct {
	TemplateID        string
	ServiceFamilyID   string
	Name              string
	Description       string
	Version           string
	LocalizationKey   string
	BrandIcon         string
	SourceURL         string
	DockerSourceURL   string
	Deployment        Deployment
	ContainerMode     string
	Revision          int64
	SortOrder         int
	DeveloperPreview  bool
	DiskBytes         int64
	Notices           []TemplateNotice
	DefaultAccessMode string
}

func builtInTemplateDefinitions() []builtInTemplateDefinition {
	return []builtInTemplateDefinition{
		{
			TemplateID: DeepSeekHarnessHostTemplateID, ServiceFamilyID: DeepSeekHarnessTemplateID,
			Name: "DeepSeek Harness · Host", Description: "Run DeepSeek Harness directly in the current Environment.", Version: DeepSeekHarnessVersion,
			LocalizationKey: "deepSeekHarnessHost", BrandIcon: BrandIconDeepSeekHarness, SourceURL: "https://github.com/deepseek-ai/deepseek-harness",
			Deployment: DeploymentNative, Revision: 1, SortOrder: 10, DeveloperPreview: true, DiskBytes: 2 * 1024 * 1024 * 1024,
			Notices:           deepSeekHarnessNotices(false),
			DefaultAccessMode: pfregistry.AccessModeDesktopLoopback,
		},
		{
			TemplateID: DeepSeekHarnessContainerTemplateID, ServiceFamilyID: DeepSeekHarnessTemplateID,
			Name: "DeepSeek Harness · Container", Description: "Run the reviewed community DeepSeek Harness image in Docker.", Version: DeepSeekHarnessVersion,
			LocalizationKey: "deepSeekHarnessContainer", BrandIcon: BrandIconDeepSeekHarness, SourceURL: "https://github.com/deepseek-ai/deepseek-harness",
			DockerSourceURL: "https://github.com/runzhliu/deepseek-harness-docker", Deployment: DeploymentDocker, ContainerMode: "single",
			Revision: 1, SortOrder: 20, DeveloperPreview: true, DiskBytes: 2 * 1024 * 1024 * 1024, Notices: deepSeekHarnessNotices(true),
			DefaultAccessMode: pfregistry.AccessModeDesktopLoopback,
		},
		{
			TemplateID: WebtopUbuntuKDETemplateID, ServiceFamilyID: WebtopUbuntuKDETemplateID,
			Name: "LinuxServer Webtop · Ubuntu (KDE Plasma)", Description: "Run an Ubuntu-based KDE Plasma desktop in an isolated Docker container; its appearance differs from standard Ubuntu Desktop (GNOME).", Version: webtopUbuntuKDEVersion,
			LocalizationKey: "linuxserverWebtopUbuntuKDE", BrandIcon: BrandIconUbuntu, SourceURL: webtopSourceURL,
			Deployment: DeploymentContainer, ContainerMode: "single", Revision: 1, SortOrder: 30, DiskBytes: 6 * 1024 * 1024 * 1024,
			Notices: webtopNotices(),
		},
		{
			TemplateID: WebtopDebianXFCETemplateID, ServiceFamilyID: WebtopDebianXFCETemplateID,
			Name: "LinuxServer Webtop · Debian XFCE", Description: "Run a Debian XFCE desktop in an isolated Docker container.", Version: webtopDebianXFCEVersion,
			LocalizationKey: "linuxserverWebtopDebianXFCE", BrandIcon: BrandIconDebian, SourceURL: webtopSourceURL,
			Deployment: DeploymentContainer, ContainerMode: "single", Revision: 1, SortOrder: 40, DiskBytes: 6 * 1024 * 1024 * 1024,
			Notices: webtopNotices(),
		},
	}
}

func builtInTemplateDefinitionByID(templateID string) (builtInTemplateDefinition, bool) {
	templateID = strings.TrimSpace(templateID)
	for _, definition := range builtInTemplateDefinitions() {
		if definition.TemplateID == templateID {
			return definition, true
		}
	}
	return builtInTemplateDefinition{}, false
}

func deepSeekHarnessNotices(includeCommunityImage bool) []TemplateNotice {
	notices := []TemplateNotice{{
		ID: "service-api-credentials", Revision: 1, Severity: "info",
		TitleKey: "webServices.managed.notices.apiCredentials.title", DescriptionKey: "webServices.managed.notices.apiCredentials.description",
	}}
	if includeCommunityImage {
		notices = append([]TemplateNotice{{
			ID: "community-container-image", Revision: 1, Severity: "warning",
			TitleKey: "webServices.managed.notices.communityImage.title", DescriptionKey: "webServices.managed.notices.communityImage.description",
		}}, notices...)
	}
	return notices
}

func webtopNotices() []TemplateNotice {
	return []TemplateNotice{{
		ID: webtopRootNoticeID, Revision: 1, Severity: "warning", AcknowledgementRequired: true,
		TitleKey:       "webServices.managed.notices.interactiveDesktopRoot.title",
		DescriptionKey: "webServices.managed.notices.interactiveDesktopRoot.description",
	}}
}

func auditedWebtopArtifact(templateID, platform string) (dockerArtifact, bool) {
	digest := ""
	switch templateID + ":" + platform {
	case WebtopUbuntuKDETemplateID + ":linux-amd64":
		digest = "sha256:277ccc2688301ab076b6654ecb031a0061f34199add3d77503073ff3d8da429e"
	case WebtopUbuntuKDETemplateID + ":linux-arm64":
		digest = "sha256:3c35983ef7148cd14dd93d57dff9791d6a6b9d6018781e252edcfae0fe7d2f17"
	case WebtopDebianXFCETemplateID + ":linux-amd64":
		digest = "sha256:686b8fac99918330a7a897ea8ab9e0aeeb822e7b4f5f5aeb837fa984f21d3c2b"
	case WebtopDebianXFCETemplateID + ":linux-arm64":
		digest = "sha256:9092b349d525f765b0be912db1ec5a8d5aa97b0f1a3b57da27a7f72e69c90825"
	default:
		return dockerArtifact{}, false
	}
	return dockerArtifact{Image: webtopImage, Digest: digest}, true
}

func webtopTemplateSpec(templateID string, artifact dockerArtifact) TemplateSpec {
	title := "Ubuntu KDE"
	if templateID == WebtopDebianXFCETemplateID {
		title = "Debian XFCE"
	}
	return TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentContainer,
		Endpoint:      WebEndpointSpec{Scheme: "http", ContainerPort: 3000, Path: "/", HealthPath: "/", StartupTimeout: 180},
		Container: &ContainerTemplateSpec{
			Image: artifact.Image + "@" + artifact.Digest,
			Environment: map[string]string{
				"PUID": "${REDEVEN_RUNTIME_UID}", "PGID": "${REDEVEN_RUNTIME_GID}", "TZ": "${REDEVEN_RUNTIME_TIMEZONE}",
				"TITLE": title, "START_DOCKER": "false", "FILE_MANAGER_PATH": "/workspace",
				"SELKIES_USE_CPU":        "true|locked",
				"SELKIES_ENABLE_SHARING": "false|locked", "SELKIES_ENABLE_COLLAB": "false|locked", "SELKIES_ENABLE_SHARED": "false|locked",
				"SELKIES_UI_SIDEBAR_SHOW_SHARING": "false|locked",
			},
			Mounts:       []ContainerMountSpec{{Type: "volume", Source: "config", Target: "/config"}, {Type: "workspace", Target: "/workspace"}},
			ReadOnlyRoot: false, PIDsLimit: 2048, RuntimeProfile: ContainerRuntimeProfileInteractiveDesktop,
		},
	}
}

func deepSeekHostTemplateSpec() TemplateSpec {
	return TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", Path: "/", HealthPath: "/", StartupTimeout: 45}, Host: &HostTemplateSpec{StartScript: `exec "$REDEVEN_INSTALL_EXECUTABLE" web --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT"`, RuntimeBundle: deepSeekRuntimeBundleID}}
}

func deepSeekContainerTemplateSpec(artifact dockerArtifact, available bool) TemplateSpec {
	image := auditedDockerImage
	if available {
		image = artifact.Image + "@" + artifact.Digest
	}
	return TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3080, Path: "/", HealthPath: "/", StartupTimeout: 45}, Container: &ContainerTemplateSpec{Image: image, Environment: map[string]string{"DSH_DESKTOP_ENABLED": "0", "DSH_HOME": "/home/node/.dsh", "HOME": "/workspace"}, Mounts: []ContainerMountSpec{{Type: "volume", Source: "data", Target: "/home/node/.dsh"}, {Type: "workspace", Target: "/workspace"}, {Type: "tmpfs", Target: "/tmp"}}, User: "1000:1000", ReadOnlyRoot: true, PIDsLimit: 512}}
}

func (m *Manager) builtInCatalog(ctx context.Context) ([]Template, error) {
	nativeAvailable := (runtime.GOOS == "linux" || runtime.GOOS == "darwin") && (runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64")
	nativeReasonCode, nativeReason := "", ""
	if !nativeAvailable {
		nativeReasonCode, nativeReason = "PLATFORM_UNSUPPORTED", "Direct installation supports Linux and macOS on x64 or arm64."
	} else if artifact, ok := auditedNativeArtifact(currentPlatformKey()); !ok || validateNativeArtifact(artifact, m.downloads.packageHTTPClient(), defaultNodePackageOrigin) != nil {
		nativeAvailable, nativeReasonCode, nativeReason = false, "NATIVE_RUNTIME_UNAVAILABLE", "This Redeven release does not include a usable host runtime for the Environment platform."
	}
	dockerAvailable, dockerReasonCode, dockerReason := m.dockerAvailability(ctx)

	items := make([]Template, 0, len(builtInTemplateDefinitions()))
	for _, definition := range builtInTemplateDefinitions() {
		available, reasonCode, reason := dockerAvailable, dockerReasonCode, dockerReason
		var spec TemplateSpec
		switch definition.TemplateID {
		case DeepSeekHarnessHostTemplateID:
			available, reasonCode, reason = nativeAvailable, nativeReasonCode, nativeReason
			spec = deepSeekHostTemplateSpec()
		case DeepSeekHarnessContainerTemplateID:
			artifact, artifactAvailable := auditedDockerArtifact("linux-" + runtime.GOARCH)
			if available && (!artifactAvailable || artifact.Image != auditedDockerImage || !dockerDigestPattern.MatchString(artifact.Digest)) {
				available, reasonCode, reason = false, "DOCKER_PLATFORM_UNSUPPORTED", "The reviewed DeepSeek Harness image does not include this CPU architecture."
			}
			spec = deepSeekContainerTemplateSpec(artifact, artifactAvailable)
		case WebtopUbuntuKDETemplateID, WebtopDebianXFCETemplateID:
			artifact, artifactAvailable := auditedWebtopArtifact(definition.TemplateID, "linux-"+runtime.GOARCH)
			if available && (!artifactAvailable || artifact.Image != webtopImage || !dockerDigestPattern.MatchString(artifact.Digest)) {
				available, reasonCode, reason = false, "DOCKER_PLATFORM_UNSUPPORTED", "This LinuxServer Webtop desktop does not include the Environment CPU architecture."
			}
			if artifactAvailable {
				spec = webtopTemplateSpec(definition.TemplateID, artifact)
			} else {
				spec = webtopTemplateSpec(definition.TemplateID, dockerArtifact{Image: webtopImage, Digest: "sha256:" + strings.Repeat("0", 64)})
			}
		}
		workspace, err := m.prepareDefaultWorkspace(definition.ServiceFamilyID)
		if err != nil {
			return nil, err
		}
		items = append(items, Template{
			TemplateID: definition.TemplateID, ServiceFamilyID: definition.ServiceFamilyID, Name: definition.Name, Description: definition.Description,
			Version: definition.Version, LocalizationKey: definition.LocalizationKey, BrandIcon: definition.BrandIcon, Notices: definition.Notices,
			DeveloperPreview: definition.DeveloperPreview, DiskBytes: definition.DiskBytes, DataLocation: filepath.Join(m.stateDir, definition.ServiceFamilyID, "data"),
			SourceURL: definition.SourceURL, DockerSourceURL: definition.DockerSourceURL, Source: "builtin", Deployment: definition.Deployment,
			ContainerMode: definition.ContainerMode, Revision: definition.Revision, Editable: false,
			Duplicateable: definition.TemplateID != WebtopUbuntuKDETemplateID && definition.TemplateID != WebtopDebianXFCETemplateID && completeBuiltInDuplicateSpec(spec),
			Available:     available, ReasonCode: reasonCode, Reason: reason, SortOrder: definition.SortOrder,
			Deployments:          []DeploymentAvailability{{Deployment: definition.Deployment, Available: available, ReasonCode: reasonCode, Reason: reason}},
			DefaultWorkspacePath: workspace, WorkspaceRoots: m.workspaceRoots(), Spec: &spec,
			DefaultAccessMode: defaultAccessMode(definition.DefaultAccessMode),
		})
	}
	return items, nil
}

func defaultAccessMode(value string) string {
	if strings.TrimSpace(value) == pfregistry.AccessModeDesktopLoopback {
		return pfregistry.AccessModeDesktopLoopback
	}
	return pfregistry.AccessModeUnifiedProxy
}
