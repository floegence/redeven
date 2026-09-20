package portforward

import (
	"context"
	"testing"
	"time"
)

func TestOwnedForwardLivesUntilOwnerReleasesIt(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	f, err := s.OpenOwnedForwardSession(ctx, "http://127.0.0.1:45454/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Now().Add(24 * time.Hour) }
	if got, err := s.GetForward(ctx, f.Forward.ForwardID); err != nil || got == nil {
		t.Fatalf("owned route expired: %v", err)
	}
	if _, err := s.SaveForwardSession(ctx, f.Forward.ForwardID, SaveForwardSessionRequest{Name: "saved"}); err == nil {
		t.Fatal("owned route must not outlive its application through Save")
	}
	if _, err := s.OpenOwnedForwardSession(ctx, f.Forward.TargetURL); err == nil {
		t.Fatal("two owners acquired the same address")
	}
	s.ReleaseOwnedForwardSession(f.Forward.ForwardID)
	if got, err := s.GetForward(ctx, f.Forward.ForwardID); err != nil || got != nil {
		t.Fatalf("released route remains: %+v, %v", got, err)
	}
}
