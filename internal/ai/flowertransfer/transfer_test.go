package flowertransfer

import "testing"

func TestBuildTransferPlan_ClassifiesConflictsSkipsByPolicyAndHashesApproval(t *testing.T) {
	t.Parallel()

	manifest := TransferManifest{
		SourceEndpoint: "env_src",
		SourceThreadID: "th_src",
		SourceRunID:    "run_src",
		Items: []TransferManifestItem{
			{ItemID: "identical", Kind: "file", SourcePath: "/src/keep.txt", RelativePath: "keep.txt", SizeBytes: 12, SHA256: "aaa"},
			{ItemID: "changed", Kind: "file", SourcePath: "/src/app.go", RelativePath: "app.go", SizeBytes: 20, SHA256: "bbb"},
			{ItemID: "new", Kind: "file", SourcePath: "/src/new.txt", RelativePath: "new.txt", SizeBytes: 5, SHA256: "ccc"},
			{ItemID: "too-large", Kind: "file", SourcePath: "/src/large.bin", RelativePath: "large.bin", SizeBytes: 9000, SHA256: "ddd"},
			{ItemID: "nested", Kind: "file", SourcePath: "/src/missing/leaf.txt", RelativePath: "missing/leaf.txt", SizeBytes: 1, SHA256: "eee"},
		},
	}
	destination := TransferDestination{
		EndpointID: "env_dest",
		ThreadID:   "th_dest",
		RootPath:   "/workspace",
		Existing: []TransferDestinationItem{
			{Path: "/workspace/keep.txt", Kind: "file", SizeBytes: 12, SHA256: "aaa"},
			{Path: "/workspace/app.go", Kind: "file", SizeBytes: 19, SHA256: "old"},
		},
	}
	policy := TransferPolicy{
		SkipUnchanged:   true,
		RequireApproval: true,
		MaxItemBytes:    1024,
	}

	plan, err := BuildTransferPlan(manifest, destination, policy)
	if err != nil {
		t.Fatalf("BuildTransferPlan: %v", err)
	}
	if plan.ManifestHash == "" || plan.ApprovalHash == "" {
		t.Fatalf("missing hashes: %#v", plan)
	}
	if plan.OperationCount != 3 || plan.ReviewCount != 3 || plan.SkippedCount != 2 {
		t.Fatalf("counts op=%d review=%d skipped=%d", plan.OperationCount, plan.ReviewCount, plan.SkippedCount)
	}

	byID := map[string]TransferPlanItem{}
	for _, item := range plan.Items {
		byID[item.ItemID] = item
	}
	if got := byID["identical"]; got.Conflict != TransferConflictIdentical || got.Decision != TransferDecisionSkip || got.SkipReason != "policy.skip_unchanged" {
		t.Fatalf("identical item = %#v", got)
	}
	if got := byID["changed"]; got.Conflict != TransferConflictContent || got.Decision != TransferDecisionReview || !got.RequiresReview {
		t.Fatalf("changed item = %#v", got)
	}
	if got := byID["new"]; got.Conflict != TransferConflictNone || got.DestinationPath != "/workspace/new.txt" || got.Decision != TransferDecisionReview {
		t.Fatalf("new item = %#v", got)
	}
	if got := byID["too-large"]; got.Decision != TransferDecisionSkip || got.SkipReason != "policy.max_item_bytes" {
		t.Fatalf("large item = %#v", got)
	}
	if got := byID["nested"]; got.Conflict != TransferConflictMissingParent || got.Decision != TransferDecisionReview {
		t.Fatalf("nested item = %#v", got)
	}

	again, err := BuildTransferPlan(manifest, destination, policy)
	if err != nil {
		t.Fatalf("BuildTransferPlan again: %v", err)
	}
	if again.ApprovalHash != plan.ApprovalHash || again.ManifestHash != plan.ManifestHash {
		t.Fatalf("hashes changed across equivalent build: first=%s/%s again=%s/%s", plan.ManifestHash, plan.ApprovalHash, again.ManifestHash, again.ApprovalHash)
	}
}

func TestBuildTransferPlan_PlannedDirectorySatisfiesDestinationParent(t *testing.T) {
	t.Parallel()

	plan, err := BuildTransferPlan(TransferManifest{
		Items: []TransferManifestItem{
			{ItemID: "dir", Kind: "directory", RelativePath: "newdir"},
			{ItemID: "file", Kind: "file", RelativePath: "newdir/file.txt", SHA256: "abc", SizeBytes: 3},
		},
	}, TransferDestination{RootPath: "/dst"}, TransferPolicy{})
	if err != nil {
		t.Fatalf("BuildTransferPlan: %v", err)
	}
	byID := map[string]TransferPlanItem{}
	for _, item := range plan.Items {
		byID[item.ItemID] = item
	}
	if got := byID["file"]; got.Conflict != TransferConflictNone {
		t.Fatalf("file conflict=%q, want none; item=%#v", got.Conflict, got)
	}
}

func TestBuildTransferPlan_RejectsUnsafeRelativePaths(t *testing.T) {
	t.Parallel()

	tests := []string{
		"../secret.txt",
		"safe/../../secret.txt",
		"/absolute.txt",
		`safe\..\secret.txt`,
		"safe//secret.txt",
		"safe/./secret.txt",
	}
	for _, rel := range tests {
		t.Run(rel, func(t *testing.T) {
			_, err := BuildTransferPlan(TransferManifest{
				Items: []TransferManifestItem{{
					ItemID:       "item",
					Kind:         TransferKindFile,
					SourcePath:   "/src/item.txt",
					RelativePath: rel,
				}},
			}, TransferDestination{RootPath: "/dst"}, TransferPolicy{})
			if err == nil {
				t.Fatalf("BuildTransferPlan accepted unsafe relative path %q", rel)
			}
		})
	}
}
