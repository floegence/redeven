package gatewayflow

import (
	"context"
	"errors"
	"testing"
)

func TestSharedBudgetAndClosureReceipts(t *testing.T) {
	budget := New(2, 3)
	lanCtx, lanCancel := context.WithCancel(context.Background())
	defer lanCancel()
	cloudCtx, cloudCancel := context.WithCancel(context.Background())
	defer cloudCancel()
	lan, err := budget.Reserve("a", 1, LAN, lanCancel)
	if err != nil {
		t.Fatal(err)
	}
	cloud, err := budget.Reserve("a", 1, Cloud, cloudCancel)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := budget.Reserve("a", 2, LAN, lanCancel); !errors.Is(err, ErrCapacity) {
		t.Fatalf("per-member limit: %v", err)
	}
	b, err := budget.Reserve("b", 1, LAN, lanCancel)
	if err != nil {
		t.Fatal("one member exhausted another member's capacity", err)
	}
	if _, err := budget.Reserve("c", 1, Cloud, cloudCancel); !errors.Is(err, ErrCapacity) {
		t.Fatalf("total limit: %v", err)
	}
	stats := budget.Statistics()
	if stats.Active != 3 || stats.LAN != 2 || stats.Cloud != 1 || stats.Limit != 3 || stats.Accepted != 3 || stats.Rejected != 2 {
		t.Fatalf("shared admission counters: %+v", stats)
	}
	budget.Cancel("a", 1, Cloud)
	if cloudCtx.Err() == nil || lanCtx.Err() != nil {
		t.Fatal("Cloud revocation crossed the LAN boundary")
	}
	if budget.Count("a", 1, Cloud) != 1 {
		t.Fatal("closure acknowledged before workers stopped")
	}
	if budget.Statistics().Active != 3 {
		t.Fatal("pending cancellation disappeared from resource gauge")
	}
	cloud.Release()
	cloud.Release()
	if stats := budget.Statistics(); stats.Active != 2 || stats.Cloud != 0 || stats.Accepted != 3 {
		t.Fatalf("released resource counters: %+v", stats)
	}
	if budget.Count("a", 1, Cloud) != 0 {
		t.Fatal("completed closure still pending")
	}
	budget.Close()
	if lanCtx.Err() == nil {
		t.Fatal("shutdown did not cancel LAN")
	}
	lan.Release()
	b.Release()
	if budget.Count("", 0, "") != 0 {
		t.Fatal("reservations leaked")
	}
	if _, err := budget.Reserve("d", 1, LAN, lanCancel); !errors.Is(err, ErrCapacity) {
		t.Fatal("closed budget admitted a stream")
	}
}
