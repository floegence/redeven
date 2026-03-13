package codeapp

import "testing"

func TestParseControlplaneBase_DerivesTrustedLauncherOrigins(t *testing.T) {
	t.Parallel()

	origin, err := parseControlplaneBase("https://dev.redeven.test")
	if err != nil {
		t.Fatalf("parseControlplaneBase: %v", err)
	}
	if !origin.configured() {
		t.Fatal("expected configured origin")
	}

	if got := origin.sandboxBaseDomain(); got != "redeven-sandbox.test" {
		t.Fatalf("sandboxBaseDomain = %q, want %q", got, "redeven-sandbox.test")
	}

	cases := []struct {
		name      string
		sandboxID string
		want      string
	}{
		{name: "codespace", sandboxID: "cs-demo", want: "https://cs-demo.dev.redeven-sandbox.test"},
		{name: "portforward", sandboxID: "pf-demo", want: "https://pf-demo.dev.redeven-sandbox.test"},
		{name: "envapp", sandboxID: "env-demo", want: "https://env-demo.dev.redeven-sandbox.test"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := origin.trustedLauncherOrigin(tc.sandboxID)
			if err != nil {
				t.Fatalf("trustedLauncherOrigin: %v", err)
			}
			if got != tc.want {
				t.Fatalf("trustedLauncherOrigin(%q) = %q, want %q", tc.sandboxID, got, tc.want)
			}
		})
	}
}

func TestParseControlplaneBase_PreservesPortInTrustedLauncherOrigins(t *testing.T) {
	t.Parallel()

	origin, err := parseControlplaneBase("https://dev.redeven.test:8443")
	if err != nil {
		t.Fatalf("parseControlplaneBase: %v", err)
	}

	got, err := origin.trustedLauncherOrigin("cs-demo")
	if err != nil {
		t.Fatalf("trustedLauncherOrigin: %v", err)
	}
	if got != "https://cs-demo.dev.redeven-sandbox.test:8443" {
		t.Fatalf("trustedLauncherOrigin = %q, want %q", got, "https://cs-demo.dev.redeven-sandbox.test:8443")
	}
}

func TestParseControlplaneBase_RejectsMissingRegionHost(t *testing.T) {
	t.Parallel()

	if _, err := parseControlplaneBase("https://redeven.test"); err == nil {
		t.Fatal("expected invalid controlplane host error")
	}
}

func TestServiceExternalOrigins_UseTrustedLauncherDomainModel(t *testing.T) {
	t.Parallel()

	origin, err := parseControlplaneBase("https://sg.redeven.test")
	if err != nil {
		t.Fatalf("parseControlplaneBase: %v", err)
	}
	svc := &Service{cpOrigin: origin}

	codeOrigin, err := svc.ExternalOriginForCodeSpace("demo")
	if err != nil {
		t.Fatalf("ExternalOriginForCodeSpace: %v", err)
	}
	if codeOrigin != "https://cs-demo.sg.redeven-sandbox.test" {
		t.Fatalf("ExternalOriginForCodeSpace = %q", codeOrigin)
	}

	forwardOrigin, err := svc.ExternalOriginForPortForward("pf123")
	if err != nil {
		t.Fatalf("ExternalOriginForPortForward: %v", err)
	}
	if forwardOrigin != "https://pf-pf123.sg.redeven-sandbox.test" {
		t.Fatalf("ExternalOriginForPortForward = %q", forwardOrigin)
	}

	envOrigin, err := svc.ExternalOriginForEnvApp("env_demo")
	if err != nil {
		t.Fatalf("ExternalOriginForEnvApp: %v", err)
	}
	if envOrigin != "https://env-demo.sg.redeven-sandbox.test" {
		t.Fatalf("ExternalOriginForEnvApp = %q", envOrigin)
	}
}
