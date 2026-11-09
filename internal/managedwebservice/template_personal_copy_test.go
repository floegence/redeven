package managedwebservice

import (
	"context"
	templatecontract "github.com/floegence/redeven-service-templates/template"
	"os"
	"path/filepath"
	"strings"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestPersonalCopyRetainsSourceAfterLibraryDeletion(t *testing.T) {
	ctx := context.Background()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	scope, state := newManagedServiceTestScope(t)
	m := &Manager{registry: registry, scope: scope, stateDir: state}
	snapshot := sourceSnapshot(t, `exec "$REDEVEN_TEMPLATE_DIR/scripts/start.sh"`)
	preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot})
	if err != nil {
		t.Fatal(err)
	}
	original, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "personal-source", CandidateID: preview.CandidateID, SHA256: snapshot.SHA256})
	if err != nil {
		t.Fatal(err)
	}
	copy, err := m.DuplicateTemplate(ctx, original.TemplateID, TemplateDuplicateRequest{RequestID: "personal-copy", Name: "My service"})
	if err != nil {
		t.Fatal(err)
	}
	if !copy.Editable || copy.Source != "custom" || copy.ServiceFamilyID == original.ServiceFamilyID {
		t.Fatalf("copy = %+v", copy)
	}
	nextSource := sourceSnapshot(t, "exec updated-original")
	nextPreview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &nextSource})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "personal-original-update", CandidateID: nextPreview.CandidateID, SHA256: nextSource.SHA256, ExpectedSHA256: snapshot.SHA256}); err != nil {
		t.Fatal(err)
	}
	pinned, err := m.Template(ctx, copy.TemplateID)
	if err != nil || pinned.SourceSHA256 != snapshot.SHA256 || pinned.Spec.Host.StartScript != original.Spec.Host.StartScript {
		t.Fatal("original update mutated personal copy", err)
	}
	if err := m.DeleteTemplate(ctx, original.TemplateID); err != nil {
		t.Fatal(err)
	}
	if err := registry.CollectUnreferencedTemplateVersions(ctx); err != nil {
		t.Fatal(err)
	}
	reopened, err := m.Template(ctx, copy.TemplateID)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.SourceDirectory != original.SourceDirectory || reopened.SourceRuntimeSHA256 != original.SourceRuntimeSHA256 {
		t.Fatal("copy lost pinned runtime files")
	}
	if _, err := os.Stat(filepath.Join(reopened.SourceDirectory, "scripts/start.sh")); err != nil {
		t.Fatal(err)
	}
	next := cloneTemplateSpec(*copy.Spec)
	next.Host.StartScript = "exec custom"
	updated, err := m.UpdateTemplate(ctx, copy.TemplateID, TemplateWriteRequest{RequestID: "personal-edit", Name: "My edited service", Spec: next})
	if err != nil || updated.Spec.Host.StartScript != "exec custom" {
		t.Fatal("personal edit failed", err)
	}
	again, err := m.DuplicateTemplate(ctx, copy.TemplateID, TemplateDuplicateRequest{RequestID: "personal-copy-again", Name: "Second personal service"})
	if err != nil || again.SourceDirectory != original.SourceDirectory {
		t.Fatal("copy of copy lost originals", err)
	}
}

func TestPersonalCopyCandidateOwnershipAndReplay(t *testing.T) {
	ctx := context.Background()
	m := sourceManager(t)
	snapshot := sourceSnapshot(t, "exec helper")
	preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot})
	if err != nil {
		t.Fatal(err)
	}
	req := TemplateDuplicateRequest{RequestID: "personal-candidate-copy", Name: "Personal candidate", Source: sourceSelection(preview), SourceOwner: "intruder"}
	if _, err := m.DuplicateTemplate(ctx, preview.Template.TemplateID, req); err == nil {
		t.Fatal("foreign owner copied candidate")
	}
	req.SourceOwner = "owner"
	copy, err := m.DuplicateTemplate(ctx, preview.Template.TemplateID, req)
	if err != nil {
		t.Fatal(err)
	}
	if sources, _ := m.registry.ListManagedTemplateSources(ctx); len(sources) != 0 {
		t.Fatal("personal copy mutated library")
	}
	if err := m.DiscardTemplateSource(ctx, "owner", preview.CandidateID); err != nil {
		t.Fatal(err)
	}
	replay, err := m.DuplicateTemplate(ctx, preview.Template.TemplateID, req)
	if err != nil || replay.TemplateID != copy.TemplateID {
		t.Fatal("receipt replay needs expired candidate", err)
	}
	req.Name = "Different name"
	if _, err := m.DuplicateTemplate(ctx, preview.Template.TemplateID, req); err == nil {
		t.Fatal("conflicting receipt accepted")
	}
	if err := m.cleanupTemplateSourceOrphans(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Template(ctx, copy.TemplateID); err != nil {
		t.Fatal("collection lost personal source", err)
	}
	if err := os.WriteFile(filepath.Join(copy.SourceDirectory, "scripts/start.sh"), []byte("tampered"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Template(ctx, copy.TemplateID); err == nil {
		t.Fatal("personal copy ignored tampered original")
	}
}

func TestPersonalCopyIsIndependentForEveryDeployment(t *testing.T) {
	for _, kind := range []Deployment{DeploymentHost, DeploymentContainer, DeploymentCompose} {
		t.Run(string(kind), func(t *testing.T) {
			ctx := context.Background()
			m := sourceManager(t)
			spec := TemplateSpec{SchemaVersion: 6, Kind: kind, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 8080}}
			switch kind {
			case DeploymentHost:
				spec.Host = &HostTemplateSpec{StartScript: "exec original"}
			case DeploymentContainer:
				spec.Container = &ContainerTemplateSpec{Image: "example/app:1@sha256:" + strings.Repeat("a", 64)}
			case DeploymentCompose:
				spec.Compose = &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: example/app:1\n"}
			}
			snapshot := snapshotWithSpec(t, spec, 1)
			preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot})
			if err != nil {
				t.Fatal(err)
			}
			copy, err := m.DuplicateTemplate(ctx, preview.Template.TemplateID, TemplateDuplicateRequest{RequestID: "personal-copy", Name: "My service", Source: sourceSelection(preview), SourceOwner: "owner"})
			if err != nil {
				t.Fatal(err)
			}
			edited := cloneTemplateSpec(*copy.Spec)
			edited.Endpoint.HealthPath = "/personal-health"
			changed, err := m.UpdateTemplate(ctx, copy.TemplateID, TemplateWriteRequest{RequestID: "personal-edit", Name: "My edited service", Description: "Personal description", Spec: edited})
			if err != nil {
				t.Fatal(err)
			}
			if changed.Spec.Endpoint.HealthPath != "/personal-health" || preview.Template.Spec.Endpoint.HealthPath == changed.Spec.Endpoint.HealthPath {
				t.Fatal("edit was not independent")
			}
			restarted := *m
			if err := restarted.cleanupTemplateSourceOrphans(ctx); err != nil {
				t.Fatal(err)
			}
			reopened, err := restarted.Template(ctx, copy.TemplateID)
			if err != nil || reopened.Revision != 2 || reopened.Name != "My edited service" {
				t.Fatal("restart lost copy", err)
			}
			for _, locale := range reopened.Localizations {
				if locale.Name != reopened.Name || locale.Description != reopened.Description {
					t.Fatal("source localization overrode personal identity")
				}
			}
			again, err := restarted.DuplicateTemplate(ctx, copy.TemplateID, TemplateDuplicateRequest{RequestID: "copy-again", Name: "Another service"})
			if err != nil || again.SourceDirectory != reopened.SourceDirectory {
				t.Fatal("copy chain lost base", err)
			}
			if err := m.DeleteTemplate(ctx, copy.TemplateID); err != nil {
				t.Fatal(err)
			}
			if err := m.cleanupTemplateSourceOrphans(ctx); err != nil {
				t.Fatal(err)
			}
			if _, err := m.Template(ctx, again.TemplateID); err != nil {
				t.Fatal(err)
			}
			if err := m.DeleteTemplate(ctx, again.TemplateID); err != nil {
				t.Fatal(err)
			}
			if err := m.cleanupTemplateSourceOrphans(ctx); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(reopened.SourceDirectory); !os.IsNotExist(err) {
				t.Fatal("unreferenced originals retained", err)
			}
		})
	}
}

func TestPersonalCopyPreservesReviewedDesktopBoundary(t *testing.T) {
	ctx := context.Background()
	m := sourceManager(t)
	spec := TemplateSpec{SchemaVersion: 6, Kind: DeploymentContainer, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3000}, Container: &ContainerTemplateSpec{Image: "example/desktop:1@sha256:" + strings.Repeat("a", 64), RuntimeProfile: ContainerRuntimeProfileInteractiveDesktop, PIDsLimit: 2048}}
	snapshot := snapshotWithSpec(t, spec, 1)
	parsed, err := templatecontract.Read(snapshot.Files)
	if err != nil {
		t.Fatal(err)
	}
	source := sourceRecord(snapshot, parsed)
	source.ReviewedRuntimeProfile = ContainerRuntimeProfileInteractiveDesktop
	source.Directory = "source_reviewed_fixture"
	dir, err := m.sourceDirectory(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(m.sourceRoot(), 0700); err != nil {
		t.Fatal(err)
	}
	if err := templatecontract.WriteDirectory(dir, snapshot.Files); err != nil {
		t.Fatal(err)
	}
	// The private persistence boundary models an already reviewed capability.
	if err := m.registry.CommitManagedTemplateSource(ctx, source, "", pfregistry.ManagedTemplateRequest{RequestID: "reviewed-source", RequestFingerprint: "reviewed", TemplateID: source.TemplateID}); err != nil {
		t.Fatal(err)
	}
	copy, err := m.DuplicateTemplate(ctx, source.TemplateID, TemplateDuplicateRequest{RequestID: "reviewed-copy", Name: "My desktop"})
	if err != nil {
		t.Fatal(err)
	}
	if !copy.RuntimeLocked || !copy.Editable {
		t.Fatal("desktop restriction not exposed")
	}
	if _, err := m.UpdateTemplate(ctx, copy.TemplateID, TemplateWriteRequest{RequestID: "personal-rename", Name: "My renamed desktop", Spec: *copy.Spec}); err != nil {
		t.Fatal(err)
	}
	edited := cloneTemplateSpec(*copy.Spec)
	edited.Container.Image = "example/unreviewed:1"
	if _, err := m.UpdateTemplate(ctx, copy.TemplateID, TemplateWriteRequest{RequestID: "personal-escape", Name: "My desktop", Spec: edited}); err == nil {
		t.Fatal("unreviewed image inherited desktop privilege")
	}
	if _, err := m.CreateTemplate(ctx, TemplateWriteRequest{RequestID: "personal-forge", Name: "Forged desktop", Spec: *copy.Spec}); err == nil {
		t.Fatal("custom create forged capability")
	}
}
