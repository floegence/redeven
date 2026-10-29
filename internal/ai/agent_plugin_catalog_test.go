package ai

import (
	"github.com/floegence/redeven/internal/session"
	"testing"
)

func TestAgentPluginRuntimeCatalogConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name, config string
		count        int
	}{
		{name: "disabled"},
		{name: "configured", config: `[{"id":"team","name":"Team","url":"https://catalog.example.com/plugins.json"}]`, count: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("REDEVEN_AGENT_AI_PLUGIN_CATALOGS", tc.config)
			svc := &Service{stateDir: t.TempDir(), skillManager: &skillManager{}, mcpManager: &mcpManager{}}
			if err := svc.initializeAgentPlugins(); err != nil {
				t.Fatal(err)
			}
			defer svc.agentPlugins.Close()
			view, err := svc.ListAgentPlugins(&session.Meta{CanRead: true})
			if err != nil || len(view.Sources) != tc.count {
				t.Fatal(view, err)
			}
			if tc.count > 0 && (!view.Sources[0].Managed || view.Sources[0].ID != "configured:team") {
				t.Fatal(view.Sources)
			}
			if _, err := svc.ListAgentPlugins(&session.Meta{}); err == nil {
				t.Fatal("reader permission bypassed")
			}
		})
	}
}

func TestAgentPluginRuntimeRejectsMalformedCatalogConfiguration(t *testing.T) {
	t.Setenv("REDEVEN_AGENT_AI_PLUGIN_CATALOGS", "{}")
	svc := &Service{stateDir: t.TempDir(), skillManager: &skillManager{}, mcpManager: &mcpManager{}}
	if err := svc.initializeAgentPlugins(); err == nil || svc.agentPlugins != nil {
		t.Fatal("invalid config silently ignored", err)
	}
}
