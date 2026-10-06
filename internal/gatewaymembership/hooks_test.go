package gatewaymembership

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestPolicyHookProcess(t *testing.T) {
	if len(os.Args) < 2 || !strings.HasPrefix(os.Args[len(os.Args)-1], "hook:") {
		return
	}
	mode := strings.TrimPrefix(os.Args[len(os.Args)-1], "hook:")
	var input gp.HookInput
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		os.Exit(3)
	}
	if input.Version != 1 || input.Action != gp.HookAccessOpen || os.Getenv("REDEVEN_TEST_SECRET") != "" {
		os.Exit(4)
	}
	switch mode {
	case "allow":
		fmt.Fprint(os.Stdout, `{"version":1,"allowed":true,"reason_code":"APPROVED"}`)
	case "deny":
		fmt.Fprint(os.Stdout, `{"version":1,"allowed":false,"reason_code":"OUTSIDE_HOURS"}`)
	case "invalid":
		fmt.Fprint(os.Stdout, `{"version":1,"allowed":true,"reason_code":"OK","extra":true}`)
	case "trailing":
		fmt.Fprint(os.Stdout, `{"version":1,"allowed":true,"reason_code":"OK"}{}`)
	case "crash":
		os.Exit(2)
	case "timeout":
		time.Sleep(10 * time.Second)
	case "oversize":
		_, _ = io.WriteString(os.Stdout, strings.Repeat("x", hookOutputLimit+1))
	default:
		os.Exit(5)
	}
	os.Exit(0)
}

func TestPolicyHooksDenyFailuresWithoutLeakingProgramOutput(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("REDEVEN_TEST_SECRET", "must-not-reach-hook")
	for _, test := range []struct {
		mode, reason string
		allowed      bool
	}{
		{"allow", "APPROVED", true}, {"deny", "OUTSIDE_HOURS", false},
		{"invalid", "POLICY_OUTPUT_INVALID", false}, {"trailing", "POLICY_OUTPUT_INVALID", false},
		{"crash", "POLICY_EXEC_FAILED", false}, {"timeout", "POLICY_TIMEOUT", false},
		{"oversize", "POLICY_OUTPUT_LIMIT", false},
	} {
		t.Run(test.mode, func(t *testing.T) {
			hooks, err := NewPolicyHooks(HookConfig{gp.HookAccessOpen: {Path: executable, Arguments: []string{"-test.run=^TestPolicyHookProcess$", "hook:" + test.mode}}})
			if err != nil {
				t.Fatal(err)
			}
			result := hooks.Evaluate(context.Background(), gp.HookInput{Version: 1, Action: gp.HookAccessOpen, GatewayID: "gateway", PolicyRevision: 1})
			if result.Allowed != test.allowed || result.ReasonCode != test.reason {
				t.Fatalf("result %+v", result)
			}
		})
	}
}

func TestPolicyHookLimitsAndInvalidRefreshFailClosed(t *testing.T) {
	hooks, err := NewPolicyHooks(HookConfig{gp.HookAccessOpen: {Path: "/missing/program"}})
	if err != nil {
		t.Fatal(err)
	}
	input := gp.HookInput{Version: 1, Action: gp.HookAccessOpen, GatewayID: "gateway", PolicyRevision: 1}
	for range 8 {
		hooks.permits <- struct{}{}
	}
	if result := hooks.Evaluate(context.Background(), input); result.ReasonCode != "POLICY_BUSY" || result.Allowed {
		t.Fatal(result)
	}
	if err := hooks.Replace(HookConfig{gp.HookAccessOpen: {Path: "relative/program"}}); err == nil {
		t.Fatal("relative command accepted")
	}
	for action, status := range hooks.Status() {
		if status != gp.HookInvalid {
			t.Fatalf("invalid refresh was reported as %s for %s", status, action)
		}
	}
	if result := hooks.Evaluate(context.Background(), input); result.ReasonCode != "POLICY_CONFIG_INVALID" || result.Allowed {
		t.Fatal(result)
	}
	if err := hooks.Replace(HookConfig{}); err != nil {
		t.Fatal(err)
	}
	if result := hooks.Evaluate(context.Background(), input); !result.Allowed || result.ReasonCode != "NO_HOOK" {
		t.Fatal(result)
	}
}
