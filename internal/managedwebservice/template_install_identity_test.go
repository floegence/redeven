package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	templatecontract "github.com/floegence/redeven-service-templates/template"
)

func TestMarketInstallIdentityAndWorkspaceAcrossDeployments(t *testing.T) {
	for _, kind := range []Deployment{DeploymentHost, DeploymentContainer, DeploymentCompose} {
		t.Run(string(kind), func(t *testing.T) {
			ctx := context.Background()
			m := sourceManager(t)
			spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: kind, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 8080}}
			switch kind {
			case DeploymentHost:
				spec.Host = &HostTemplateSpec{StartScript: "exec service"}
			case DeploymentContainer:
				spec.Container = &ContainerTemplateSpec{Image: "example/service:1@sha256:" + strings.Repeat("a", 64)}
			case DeploymentCompose:
				spec.Compose = &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: example/service:1\n"}
			}
			snapshot := snapshotWithSpec(t, spec, 1)
			var document templatecontract.Document
			if err := json.Unmarshal(snapshot.Files[0].Content, &document); err != nil {
				t.Fatal(err)
			}
			document.SchemaVersion = 4
			snapshot.Files[0].Content, _ = json.Marshal(document)
			snapshot.SHA256, _ = templatecontract.Digest(snapshot.Files)
			market, err := templatecontract.InspectMarketTemplate(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot})
			if err != nil {
				t.Fatal(err)
			}
			accepted, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "identity-import", CandidateID: preview.CandidateID, SHA256: preview.SHA256})
			if err != nil {
				t.Fatal(err)
			}
			if accepted.TemplateID != market.TemplateID || accepted.ServiceFamilyID != market.ServiceFamilyID {
				t.Fatal("market and accepted source use different identities")
			}
			req := CreateRequest{RequestID: "identity-install", TemplateID: market.TemplateID, Deployment: kind, WorkspacePath: accepted.DefaultWorkspacePath}
			plan, err := m.PreflightInstall(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			expected := filepath.Join(accepted.DefaultWorkspacePath, strings.TrimPrefix(plan.ServiceID, "mws_"))
			if plan.WorkspacePath != expected || filepath.Base(accepted.DefaultWorkspacePath) != market.TemplateID {
				t.Fatalf("workspace does not follow template/instance identity: %s", plan.WorkspacePath)
			}
			// Both callers can preflight, but only one may commit the family.
			other := req
			other.RequestID = "identity-competing-install"
			otherPlan, err := m.PreflightInstall(ctx, other)
			if err != nil {
				t.Fatal(err)
			}
			other.PlanDigest, other.WorkspacePath = otherPlan.PlanDigest, otherPlan.WorkspacePath
			req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
			created, err := m.Create(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			if created.Service.TemplateID != market.TemplateID || created.Service.WorkspacePath != expected {
				t.Fatal("installation changed the selected identity or workspace")
			}
			_, preflightErr := m.PreflightInstall(ctx, other)
			_, createErr := m.Create(ctx, other)
			for stage, err := range map[string]error{"preflight": preflightErr, "commit": createErr} {
				var problem *Error
				if !errors.As(err, &problem) || problem.Code != "INSTANCE_ALREADY_EXISTS" {
					t.Fatalf("%s allowed a second instance: %v", stage, err)
				}
			}
			records, err := m.registry.ListManagedServices(ctx)
			if err != nil || len(records) != 1 || records[0].ServiceID != plan.ServiceID || records[0].WorkspacePath != expected {
				t.Fatalf("duplicate request changed the service: %+v, %v", records, err)
			}
			copy, err := m.DuplicateTemplate(ctx, accepted.TemplateID, TemplateDuplicateRequest{RequestID: "identity-copy", Name: "Personal service"})
			if err != nil {
				t.Fatal(err)
			}
			if copy.TemplateID == accepted.TemplateID || copy.ServiceFamilyID == accepted.ServiceFamilyID || copy.DefaultWorkspacePath == accepted.DefaultWorkspacePath {
				t.Fatal("personal copy reused source identity or directory")
			}
			if _, err := m.PreflightInstall(ctx, CreateRequest{TemplateID: copy.TemplateID}); err != nil {
				t.Fatalf("independent personal copy was blocked: %v", err)
			}
		})
	}
}
