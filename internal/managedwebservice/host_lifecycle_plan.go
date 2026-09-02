package managedwebservice

import "strings"

const hostLifecyclePlanSchemaVersion = 1

const (
	lifecycleOwnershipNone                    = "none"
	lifecycleOwnershipRedeven                 = "redeven"
	lifecycleOwnershipTemplate                = "template"
	lifecycleOwnershipRedevenWithTemplateHook = "redeven_with_template_hook"
)

func deepSeekWebArguments(host, port string) []string {
	return []string{"web", "--host", host, "--port", port, "--no-open"}
}

func deepSeekHostStartScript() string {
	return `exec "$REDEVEN_INSTALL_EXECUTABLE" ` + strings.Join(deepSeekWebArguments(`"$REDEVEN_SERVICE_HOST"`, `"$REDEVEN_SERVICE_PORT"`), " ")
}

func nativePackageInstallArguments() []string {
	return []string{"ci", "--omit=dev", "--legacy-peer-deps=false", "--no-audit", "--fund=false", "--progress=false", "--strict-allow-scripts"}
}

func npmPackageInstallArguments(packageName, version string) []string {
	return []string{"install", strings.TrimSpace(packageName) + "@" + strings.TrimSpace(version), "--omit=dev", "--package-lock=false", "--ignore-scripts", "--legacy-peer-deps=false", "--no-audit", "--fund=false", "--progress=false"}
}

func npmPackageRebuildArguments() []string {
	return []string{"rebuild", "--dangerously-allow-all-scripts", "--no-audit", "--fund=false", "--progress=false"}
}

func nativePackageInstallCommandTemplate() string {
	return strings.Join(append([]string{"<managed-node>", "<managed-npm-cli>"}, nativePackageInstallArguments()...), " ")
}

func hostLifecyclePlan(spec TemplateSpec) *HostLifecyclePlan {
	if spec.Kind != DeploymentHost || spec.Host == nil {
		return nil
	}
	host := spec.Host
	plan := &HostLifecyclePlan{
		SchemaVersion: hostLifecyclePlanSchemaVersion,
		Driver:        "host_script",
		RuntimeBundle: host.RuntimeBundle,
		Install:       HostLifecycleActionPlan{Ownership: lifecycleOwnershipRedeven, Steps: []HostLifecycleStep{{Kind: "prepare_managed_directories"}}},
		Start:         HostLifecycleActionPlan{Ownership: lifecycleOwnershipTemplate, Steps: []HostLifecycleStep{{Kind: "run_template_script", CommandTemplate: "<template-start-script>"}}},
		Stop:          HostLifecycleActionPlan{Ownership: lifecycleOwnershipRedeven, Steps: []HostLifecycleStep{{Kind: "terminate_managed_process_group"}}},
		Uninstall: HostLifecycleActionPlan{Ownership: lifecycleOwnershipRedeven, Steps: []HostLifecycleStep{
			{Kind: "terminate_managed_process_group"},
			{Kind: "remove_managed_installation"},
			{Kind: "remove_managed_data_on_request"},
			{Kind: "remove_managed_logs"},
		}},
	}
	managedInstall := false
	if host.NPM != nil {
		managedInstall = true
		copy := *host.NPM
		copy.AuthTokenParameter = ""
		plan.Driver = "npm_host"
		plan.RuntimeBundle = "node-" + nodeVersion
		plan.NPM = &copy
		if artifact, ok := auditedNativeArtifact(currentPlatformKey()); ok {
			plan.Package = lifecyclePackage(artifact)
		}
		plan.Install.Steps = append(plan.Install.Steps,
			HostLifecycleStep{Kind: "prepare_verified_node_runtime", Reference: plan.RuntimeBundle},
			HostLifecycleStep{Kind: "install_npm_package_without_scripts", Reference: copy.PackageName + "@" + copy.Version, CommandTemplate: strings.Join(append([]string{"<managed-node>", "<managed-npm-cli>"}, npmPackageInstallArguments(copy.PackageName, copy.Version)...), " ")},
			HostLifecycleStep{Kind: "remove_temporary_registry_credentials"},
			HostLifecycleStep{Kind: "run_npm_lifecycle_scripts", CommandTemplate: strings.Join(append([]string{"<managed-node>", "<managed-npm-cli>"}, npmPackageRebuildArguments()...), " ")},
			HostLifecycleStep{Kind: "verify_npm_release_identity", Reference: copy.PackageName + "@" + copy.Version},
		)
		if copy.PackageName == "@deepseek-ai/dsh" && strings.TrimSpace(host.StartScript) == deepSeekHostStartScript() {
			plan.Start.Steps[0].CommandTemplate = strings.Join(append([]string{"<managed-executable>"}, deepSeekWebArguments("<service-host>", "<service-port>")...), " ")
		}
	} else if host.RuntimeBundle != "" {
		managedInstall = true
		reference := host.RuntimeBundle
		if artifact, ok := auditedNativeArtifact(currentPlatformKey()); ok {
			plan.Package = lifecyclePackage(nativeArtifact{
				DownloadURL: artifact.DownloadURL,
				SHA256:      artifact.SHA256,
				SizeBytes:   artifact.SizeBytes,
			})
			reference = plan.Package.Reference
		}
		plan.Install.Steps = append(plan.Install.Steps,
			HostLifecycleStep{Kind: "prepare_verified_package", Reference: reference},
			HostLifecycleStep{Kind: "run_locked_dependency_install", CommandTemplate: nativePackageInstallCommandTemplate()},
		)
	} else if host.Artifact != nil {
		managedInstall = true
		plan.Package = lifecyclePackage(nativeArtifact{
			DownloadURL: host.Artifact.DownloadURL,
			SHA256:      host.Artifact.SHA256,
			SizeBytes:   host.Artifact.SizeBytes,
		})
		plan.Install.Steps = append(plan.Install.Steps, HostLifecycleStep{Kind: "prepare_verified_package", Reference: plan.Package.Reference})
	}
	if managedInstall {
		plan.Install.Ownership = lifecycleOwnershipRedeven
	}
	if strings.TrimSpace(host.InstallScript) != "" {
		commandTemplate := "<template-install-script>"
		if managedInstall {
			commandTemplate = "<after-install-hook>"
		}
		plan.Install.Steps = append(plan.Install.Steps, HostLifecycleStep{Kind: "run_template_script", CommandTemplate: commandTemplate})
		if len(plan.Install.Steps) > 1 {
			plan.Install.Ownership = lifecycleOwnershipRedevenWithTemplateHook
		} else {
			plan.Install.Ownership = lifecycleOwnershipTemplate
		}
	}

	if strings.TrimSpace(host.StopScript) != "" {
		plan.Stop.Ownership = lifecycleOwnershipRedevenWithTemplateHook
		plan.Stop.Steps = append([]HostLifecycleStep{{Kind: "run_template_script", CommandTemplate: "<before-stop-hook>"}}, plan.Stop.Steps...)
	}
	uninstallSteps := append([]HostLifecycleStep(nil), plan.Stop.Steps...)
	if strings.TrimSpace(host.UninstallScript) != "" {
		uninstallSteps = append(uninstallSteps, HostLifecycleStep{Kind: "run_template_script", CommandTemplate: "<before-uninstall-hook>"})
	}
	uninstallSteps = append(uninstallSteps,
		HostLifecycleStep{Kind: "remove_managed_installation"},
		HostLifecycleStep{Kind: "remove_managed_logs"},
		HostLifecycleStep{Kind: "remove_managed_data_on_request"},
	)
	plan.Uninstall = HostLifecycleActionPlan{Ownership: lifecycleOwnershipRedeven, Steps: uninstallSteps}
	if strings.TrimSpace(host.StopScript) != "" || strings.TrimSpace(host.UninstallScript) != "" {
		plan.Uninstall.Ownership = lifecycleOwnershipRedevenWithTemplateHook
	}
	return plan
}

func lifecyclePackage(artifact nativeArtifact) *HostLifecyclePackage {
	return &HostLifecyclePackage{
		Reference: nativeArtifactProgressReference(artifact),
		SHA256:    strings.ToLower(strings.TrimSpace(artifact.SHA256)),
		SizeBytes: artifact.SizeBytes,
	}
}
