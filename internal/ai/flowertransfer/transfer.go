package flowertransfer

import (
	"errors"
	"path"
	"sort"
	"strings"
)

const TransferPlanSchemaVersion = 1

const (
	TransferKindFile      = "file"
	TransferKindDirectory = "directory"

	TransferConflictNone          = "none"
	TransferConflictIdentical     = "identical"
	TransferConflictMissingParent = "missing_parent"
	TransferConflictTypeMismatch  = "type_mismatch"
	TransferConflictContent       = "content_mismatch"
	TransferConflictMetadata      = "metadata_mismatch"

	TransferDecisionApply  = "apply"
	TransferDecisionReview = "review"
	TransferDecisionSkip   = "skip"
)

type TransferManifest struct {
	SchemaVersion  int                    `json:"schema_version"`
	SourceEndpoint string                 `json:"source_endpoint_id,omitempty"`
	SourceThreadID string                 `json:"source_thread_id,omitempty"`
	SourceRunID    string                 `json:"source_run_id,omitempty"`
	Items          []TransferManifestItem `json:"items"`
}

type TransferManifestItem struct {
	ItemID          string            `json:"item_id"`
	Kind            string            `json:"kind"`
	SourcePath      string            `json:"source_path,omitempty"`
	RelativePath    string            `json:"relative_path"`
	SizeBytes       int64             `json:"size_bytes,omitempty"`
	SHA256          string            `json:"sha256,omitempty"`
	Mode            string            `json:"mode,omitempty"`
	UpdatedAtUnixMs int64             `json:"updated_at_unix_ms,omitempty"`
	Metadata        map[string]string `json:"metadata,omitempty"`
}

type TransferDestination struct {
	EndpointID string                    `json:"endpoint_id,omitempty"`
	ThreadID   string                    `json:"thread_id,omitempty"`
	RootPath   string                    `json:"root_path"`
	Existing   []TransferDestinationItem `json:"existing,omitempty"`
}

type TransferDestinationItem struct {
	Path        string `json:"path"`
	Kind        string `json:"kind"`
	SizeBytes   int64  `json:"size_bytes,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	Mode        string `json:"mode,omitempty"`
	ParentKnown bool   `json:"parent_known,omitempty"`
}

type TransferPolicy struct {
	SkipUnchanged     bool  `json:"skip_unchanged"`
	SkipExisting      bool  `json:"skip_existing"`
	AllowOverwrite    bool  `json:"allow_overwrite"`
	RequireApproval   bool  `json:"require_approval"`
	MaxItemBytes      int64 `json:"max_item_bytes,omitempty"`
	SkipDirectories   bool  `json:"skip_directories,omitempty"`
	SkipMissingParent bool  `json:"skip_missing_parent,omitempty"`
}

type TransferPlan struct {
	SchemaVersion   int                   `json:"schema_version"`
	ManifestHash    string                `json:"manifest_hash"`
	ApprovalHash    string                `json:"approval_hash"`
	SourceEndpoint  string                `json:"source_endpoint_id,omitempty"`
	SourceThreadID  string                `json:"source_thread_id,omitempty"`
	SourceRunID     string                `json:"source_run_id,omitempty"`
	DestEndpoint    string                `json:"dest_endpoint_id,omitempty"`
	DestThreadID    string                `json:"dest_thread_id,omitempty"`
	DestRootPath    string                `json:"dest_root_path"`
	Items           []TransferPlanItem    `json:"items"`
	OperationCount  int                   `json:"operation_count"`
	ReviewCount     int                   `json:"review_count"`
	SkippedCount    int                   `json:"skipped_count"`
	ConflictSummary map[string]int        `json:"conflict_summary"`
	Policy          TransferPolicySummary `json:"policy"`
}

type TransferPolicySummary struct {
	SkipUnchanged     bool  `json:"skip_unchanged"`
	SkipExisting      bool  `json:"skip_existing"`
	AllowOverwrite    bool  `json:"allow_overwrite"`
	RequireApproval   bool  `json:"require_approval"`
	MaxItemBytes      int64 `json:"max_item_bytes,omitempty"`
	SkipDirectories   bool  `json:"skip_directories"`
	SkipMissingParent bool  `json:"skip_missing_parent"`
}

type TransferPlanItem struct {
	ItemID          string `json:"item_id"`
	Kind            string `json:"kind"`
	SourcePath      string `json:"source_path,omitempty"`
	RelativePath    string `json:"relative_path"`
	DestinationPath string `json:"destination_path"`
	Exists          bool   `json:"exists"`
	ExistingKind    string `json:"existing_kind,omitempty"`
	Conflict        string `json:"conflict"`
	Decision        string `json:"decision"`
	SkipReason      string `json:"skip_reason,omitempty"`
	RequiresReview  bool   `json:"requires_review"`
	SizeBytes       int64  `json:"size_bytes,omitempty"`
	SHA256          string `json:"sha256,omitempty"`
	Mode            string `json:"mode,omitempty"`
}

func BuildTransferPlan(manifest TransferManifest, destination TransferDestination, policy TransferPolicy) (TransferPlan, error) {
	if err := validateTransferManifestPaths(manifest); err != nil {
		return TransferPlan{}, err
	}
	manifest = normalizeTransferManifest(manifest)
	destination = normalizeTransferDestination(destination)
	if destination.RootPath == "" {
		return TransferPlan{}, errors.New("missing destination root")
	}
	if len(manifest.Items) == 0 {
		return TransferPlan{}, errors.New("empty transfer manifest")
	}

	existing := indexDestinationItems(destination.Existing)
	plan := TransferPlan{
		SchemaVersion:   TransferPlanSchemaVersion,
		SourceEndpoint:  manifest.SourceEndpoint,
		SourceThreadID:  manifest.SourceThreadID,
		SourceRunID:     manifest.SourceRunID,
		DestEndpoint:    destination.EndpointID,
		DestThreadID:    destination.ThreadID,
		DestRootPath:    destination.RootPath,
		Items:           make([]TransferPlanItem, 0, len(manifest.Items)),
		ConflictSummary: map[string]int{},
		Policy:          TransferPolicySummary(policy),
	}
	plan.ManifestHash = mustStableHash(manifest)
	plannedDirs := indexManifestDirectories(destination.RootPath, manifest.Items)

	for _, item := range manifest.Items {
		destPath := joinDestinationPath(destination.RootPath, item.RelativePath)
		existingItem, exists := existing[destPath]
		conflict := classifyTransferConflict(item, existingItem, exists)
		if conflict == TransferConflictNone && !destinationParentExists(destination.RootPath, destPath, existing, plannedDirs) {
			conflict = TransferConflictMissingParent
		}
		plan.ConflictSummary[conflict]++

		planItem := TransferPlanItem{
			ItemID:          item.ItemID,
			Kind:            item.Kind,
			SourcePath:      item.SourcePath,
			RelativePath:    item.RelativePath,
			DestinationPath: destPath,
			Exists:          exists,
			Conflict:        conflict,
			Decision:        TransferDecisionApply,
			SizeBytes:       item.SizeBytes,
			SHA256:          item.SHA256,
			Mode:            item.Mode,
		}
		if exists {
			planItem.ExistingKind = existingItem.Kind
		}
		applyTransferDecision(&planItem, policy)
		if planItem.Decision == TransferDecisionSkip {
			plan.SkippedCount++
		} else {
			plan.OperationCount++
		}
		if planItem.RequiresReview {
			plan.ReviewCount++
		}
		plan.Items = append(plan.Items, planItem)
	}
	plan.ApprovalHash = buildTransferApprovalHash(plan)
	return plan, nil
}

func validateTransferManifestPaths(manifest TransferManifest) error {
	for _, item := range manifest.Items {
		if strings.TrimSpace(item.RelativePath) == "" {
			continue
		}
		if !isSafeRelativePath(item.RelativePath) {
			return errors.New("unsafe transfer relative path")
		}
	}
	return nil
}

func isSafeRelativePath(raw string) bool {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if raw == "" || strings.HasPrefix(raw, "/") {
		return false
	}
	for _, part := range strings.Split(raw, "/") {
		part = strings.TrimSpace(part)
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func normalizeTransferManifest(in TransferManifest) TransferManifest {
	out := TransferManifest{
		SchemaVersion:  TransferPlanSchemaVersion,
		SourceEndpoint: strings.TrimSpace(in.SourceEndpoint),
		SourceThreadID: strings.TrimSpace(in.SourceThreadID),
		SourceRunID:    strings.TrimSpace(in.SourceRunID),
		Items:          make([]TransferManifestItem, 0, len(in.Items)),
	}
	for _, item := range in.Items {
		normalized := TransferManifestItem{
			ItemID:          strings.TrimSpace(item.ItemID),
			Kind:            normalizeTransferKind(item.Kind, item.SourcePath),
			SourcePath:      cleanSlashPath(item.SourcePath),
			RelativePath:    cleanRelativePath(item.RelativePath),
			SizeBytes:       item.SizeBytes,
			SHA256:          strings.TrimSpace(strings.ToLower(item.SHA256)),
			Mode:            strings.TrimSpace(item.Mode),
			UpdatedAtUnixMs: item.UpdatedAtUnixMs,
			Metadata:        normalizeStringMap(item.Metadata),
		}
		if normalized.RelativePath == "" {
			normalized.RelativePath = cleanRelativePath(path.Base(normalized.SourcePath))
		}
		if normalized.ItemID == "" {
			normalized.ItemID = normalized.RelativePath
		}
		if normalized.RelativePath == "" {
			continue
		}
		out.Items = append(out.Items, normalized)
	}
	sort.SliceStable(out.Items, func(i, j int) bool {
		if out.Items[i].RelativePath == out.Items[j].RelativePath {
			return out.Items[i].ItemID < out.Items[j].ItemID
		}
		return out.Items[i].RelativePath < out.Items[j].RelativePath
	})
	return out
}

func normalizeTransferDestination(in TransferDestination) TransferDestination {
	out := TransferDestination{
		EndpointID: strings.TrimSpace(in.EndpointID),
		ThreadID:   strings.TrimSpace(in.ThreadID),
		RootPath:   cleanSlashPath(in.RootPath),
		Existing:   make([]TransferDestinationItem, 0, len(in.Existing)),
	}
	for _, item := range in.Existing {
		normalized := TransferDestinationItem{
			Path:        cleanSlashPath(item.Path),
			Kind:        normalizeTransferKind(item.Kind, item.Path),
			SizeBytes:   item.SizeBytes,
			SHA256:      strings.TrimSpace(strings.ToLower(item.SHA256)),
			Mode:        strings.TrimSpace(item.Mode),
			ParentKnown: item.ParentKnown,
		}
		if normalized.Path == "" {
			continue
		}
		out.Existing = append(out.Existing, normalized)
	}
	return out
}

func normalizeTransferKind(kind string, rawPath string) string {
	kind = strings.TrimSpace(strings.ToLower(kind))
	switch kind {
	case TransferKindDirectory, "dir":
		return TransferKindDirectory
	default:
		if strings.HasSuffix(strings.TrimSpace(rawPath), "/") {
			return TransferKindDirectory
		}
		return TransferKindFile
	}
}

func normalizeStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		out[key] = strings.TrimSpace(value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cleanSlashPath(raw string) string {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if raw == "" {
		return ""
	}
	cleaned := path.Clean(raw)
	if cleaned == "." {
		return ""
	}
	return cleaned
}

func cleanRelativePath(raw string) string {
	cleaned := cleanSlashPath(raw)
	cleaned = strings.TrimPrefix(cleaned, "/")
	for strings.HasPrefix(cleaned, "../") {
		cleaned = strings.TrimPrefix(cleaned, "../")
	}
	if cleaned == ".." || cleaned == "." {
		return ""
	}
	return cleaned
}

func joinDestinationPath(root string, rel string) string {
	root = cleanSlashPath(root)
	rel = cleanRelativePath(rel)
	if rel == "" {
		return root
	}
	return path.Clean(path.Join(root, rel))
}

func indexDestinationItems(items []TransferDestinationItem) map[string]TransferDestinationItem {
	out := make(map[string]TransferDestinationItem, len(items))
	for _, item := range items {
		out[item.Path] = item
	}
	return out
}

func indexManifestDirectories(root string, items []TransferManifestItem) map[string]struct{} {
	out := make(map[string]struct{})
	for _, item := range items {
		if item.Kind != TransferKindDirectory {
			continue
		}
		out[joinDestinationPath(root, item.RelativePath)] = struct{}{}
	}
	return out
}

func destinationParentExists(root string, destPath string, existing map[string]TransferDestinationItem, plannedDirs map[string]struct{}) bool {
	root = cleanSlashPath(root)
	parent := path.Dir(cleanSlashPath(destPath))
	if parent == "." || parent == "/" || parent == root || strings.HasPrefix(root, parent+"/") {
		return true
	}
	if item, ok := existing[parent]; ok && item.Kind == TransferKindDirectory {
		return true
	}
	_, planned := plannedDirs[parent]
	return planned
}

func classifyTransferConflict(item TransferManifestItem, existing TransferDestinationItem, exists bool) string {
	if !exists {
		return TransferConflictNone
	}
	if item.Kind != existing.Kind {
		return TransferConflictTypeMismatch
	}
	if item.Kind == TransferKindDirectory {
		if item.Mode != "" && existing.Mode != "" && item.Mode != existing.Mode {
			return TransferConflictMetadata
		}
		return TransferConflictIdentical
	}
	if item.SHA256 != "" && existing.SHA256 != "" {
		if item.SHA256 == existing.SHA256 {
			if item.Mode != "" && existing.Mode != "" && item.Mode != existing.Mode {
				return TransferConflictMetadata
			}
			return TransferConflictIdentical
		}
		return TransferConflictContent
	}
	if item.SizeBytes >= 0 && existing.SizeBytes >= 0 && item.SizeBytes != existing.SizeBytes {
		return TransferConflictContent
	}
	if item.Mode != "" && existing.Mode != "" && item.Mode != existing.Mode {
		return TransferConflictMetadata
	}
	return TransferConflictIdentical
}

func applyTransferDecision(item *TransferPlanItem, policy TransferPolicy) {
	if item == nil {
		return
	}
	if policy.SkipDirectories && item.Kind == TransferKindDirectory {
		item.Decision = TransferDecisionSkip
		item.SkipReason = "policy.skip_directories"
		return
	}
	if policy.MaxItemBytes > 0 && item.Kind == TransferKindFile && item.SizeBytes > policy.MaxItemBytes {
		item.Decision = TransferDecisionSkip
		item.SkipReason = "policy.max_item_bytes"
		return
	}
	if policy.SkipUnchanged && item.Conflict == TransferConflictIdentical {
		item.Decision = TransferDecisionSkip
		item.SkipReason = "policy.skip_unchanged"
		return
	}
	if policy.SkipExisting && item.Exists {
		item.Decision = TransferDecisionSkip
		item.SkipReason = "policy.skip_existing"
		return
	}
	if policy.SkipMissingParent && item.Conflict == TransferConflictMissingParent {
		item.Decision = TransferDecisionSkip
		item.SkipReason = "policy.skip_missing_parent"
		return
	}
	if policy.RequireApproval || (item.Exists && item.Conflict != TransferConflictIdentical && !policy.AllowOverwrite) {
		item.Decision = TransferDecisionReview
		item.RequiresReview = true
		return
	}
	item.Decision = TransferDecisionApply
}

func buildTransferApprovalHash(plan TransferPlan) string {
	ops := make([]map[string]any, 0, len(plan.Items))
	for _, item := range plan.Items {
		if item.Decision == TransferDecisionSkip {
			continue
		}
		ops = append(ops, map[string]any{
			"item_id":          item.ItemID,
			"kind":             item.Kind,
			"relative_path":    item.RelativePath,
			"destination_path": item.DestinationPath,
			"decision":         item.Decision,
			"conflict":         item.Conflict,
			"sha256":           item.SHA256,
			"size_bytes":       item.SizeBytes,
		})
	}
	return mustStableHash(map[string]any{
		"schema_version":   TransferPlanSchemaVersion,
		"manifest_hash":    plan.ManifestHash,
		"source_endpoint":  plan.SourceEndpoint,
		"source_thread_id": plan.SourceThreadID,
		"source_run_id":    plan.SourceRunID,
		"dest_endpoint":    plan.DestEndpoint,
		"dest_thread_id":   plan.DestThreadID,
		"dest_root_path":   plan.DestRootPath,
		"operations":       ops,
	})
}
