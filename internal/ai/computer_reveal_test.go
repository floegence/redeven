package ai

import (
	"context"
	"testing"
)

type revealingComputerExecutor struct {
	bindingTestExecutor
	revealed []string
}

func (e *revealingComputerExecutor) revealComputerTarget(_ context.Context, target string) error {
	e.revealed = append(e.revealed, target)
	return nil
}

func TestRevealRequiresCurrentOwnedConnectedTargetAndPreservesPause(t *testing.T) {
	host, _, store, _ := computerBindingFixture(t)
	executor := &revealingComputerExecutor{}
	target := TargetDescriptor{ID: "personal-page", Kind: "browser.connected", Ready: true}
	if err := host.registry.Register(target); err != nil {
		t.Fatal(err)
	}
	host.executors[target.ID] = executor
	svc := &Service{threadsDB: store, targetToolExecutor: host}
	meta := testSendTurnMeta()
	meta.EndpointID = "env"
	if err := svc.RevealComputerTarget(t.Context(), meta, "thread-first", target.ID); err == nil {
		t.Fatal("unbound page revealed")
	}
	if err := store.SetComputerTarget(t.Context(), "thread-first", target.ID); err != nil {
		t.Fatal(err)
	}
	control := host.controlForTarget(target.ID)
	control.threadID = "thread-second"
	if err := svc.RevealComputerTarget(t.Context(), meta, "thread-first", target.ID); err == nil {
		t.Fatal("another thread's page revealed")
	}
	control.threadID = "thread-first"
	control.pause = &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"captcha"}}
	meta.CanExecute = false
	if err := svc.RevealComputerTarget(t.Context(), meta, "thread-first", target.ID); err == nil {
		t.Fatal("unauthorized reveal")
	}
	meta.CanExecute = true
	if err := svc.RevealComputerTarget(t.Context(), meta, "thread-first", target.ID); err != nil {
		t.Fatal(err)
	}
	if len(executor.revealed) != 1 || executor.revealed[0] != target.ID || control.pause == nil {
		t.Fatal("reveal changed control or target")
	}
	if err := svc.RevealComputerTarget(t.Context(), meta, "thread-second", target.ID); err == nil {
		t.Fatal("reveal crossed thread binding")
	}
	if err := store.SetComputerTarget(t.Context(), "thread-first", "browser-main"); err != nil {
		t.Fatal(err)
	}
	if err := svc.RevealComputerTarget(t.Context(), meta, "thread-first", "browser-main"); err == nil {
		t.Fatal("managed browser presented as a system browser")
	}
}
