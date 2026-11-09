package storagecontract

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// IMPORTANT: This is a bounded, non-authoritative size observation. It never
// opens databases, follows symlinks, changes permissions or grants deletion.
// Cleanup belongs to each live owner, never a generic RemoveAll endpoint.
type Entry struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	Backup   string `json:"backup"`
	Bytes    int64  `json:"bytes"`
	Complete bool   `json:"complete"`
	Present  bool   `json:"present"`
}

func Entries(stateDir string) []Entry {
	specs := []struct{ id, path, kind, backup string }{
		{"configuration", "config.json", "identity", "environment"},
		{"credentials", "secrets.json", "identity", "environment"},
		{"flower", "ai", "persistent", "partial_flower"},
		{"plugins", PluginRelative, "persistent", "environment"},
		{"skills", SkillsRelative, "persistent", "environment"},
		{"computer", "computer", "mixed", "partial_flower"},
		{"task_files", "task-files", "working", "environment"},
		{"services", "apps/managed-web-services", "persistent", "environment"},
		{"service_registry", "apps/portforward", "persistent", "environment"},
		{"code", "apps/code", "persistent", "environment"},
		{"notes", "apps/notes", "persistent", "environment"},
		{"automation", "apps/automation", "persistent", "environment"},
		{"tessiven", "apps/tessiven", "persistent", "environment"},
		{"workbench", "apps/workbench", "persistent", "environment"},
		{"terminal", "apps/terminal", "persistent", "environment"},
		{"favorites", "apps/filesystem", "persistent", "environment"},
		{"read_state", "apps/appserver", "persistent", "flower"},
		{"plugin_drafts", "apps/plugin-creation", "persistent", "environment"},
		{"snapshots", "flower-maintenance", "recovery", "environment"},
		{"cache", "cache", "cache", "rebuildable"},
		{"runtime", "runtime", "mixed", "environment"},
		{"audit", "audit", "logs", "environment"},
		{"diagnostics", "diagnostics", "logs", "optional"},
	}
	out := make([]Entry, 0, len(specs))
	for _, spec := range specs {
		out = append(out, Entry{ID: spec.id, Path: filepath.Join(stateDir, filepath.FromSlash(spec.path)), Kind: spec.kind, Backup: spec.backup})
	}
	return out
}

func Inventory(ctx context.Context, stateDir string) []Entry {
	entries := Entries(stateDir)
	// One shared budget prevents a large environment from multiplying work by owner.
	budget := 20000
	root, err := os.OpenRoot(stateDir)
	if err != nil {
		return entries
	}
	defer root.Close()
	for i := range entries {
		relative, err := filepath.Rel(stateDir, entries[i].Path)
		if err != nil {
			continue
		}
		measure(ctx, root, filepath.ToSlash(relative), &entries[i], &budget)
	}
	return entries
}

func measure(ctx context.Context, root *os.Root, relative string, entry *Entry, budget *int) {
	cursor := ""
	for _, part := range strings.Split(relative, "/") {
		cursor = filepath.Join(cursor, part)
		info, err := root.Lstat(cursor)
		if errors.Is(err, os.ErrNotExist) {
			entry.Complete = true
			return
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return
		}
	}
	info, err := root.Lstat(relative)
	if errors.Is(err, os.ErrNotExist) {
		entry.Complete = true
		return
	}
	if err != nil {
		return
	}
	entry.Present = true
	if info.Mode()&os.ModeSymlink != 0 {
		return
	}
	entry.Complete = true
	var walk func(string, os.FileInfo)
	walk = func(name string, info os.FileInfo) {
		if ctx.Err() != nil || *budget <= 0 {
			entry.Complete = false
			return
		}
		*budget--
		if info.Mode()&os.ModeSymlink != 0 {
			entry.Complete = false
			return
		}
		if info.Mode().IsRegular() {
			entry.Bytes += info.Size()
			return
		}
		if !info.IsDir() {
			entry.Complete = false
			return
		}
		directory, err := root.Open(name)
		if err != nil {
			entry.Complete = false
			return
		}
		defer directory.Close()
		opened, err := directory.Stat()
		if err != nil || !os.SameFile(info, opened) {
			entry.Complete = false
			return
		}
		for {
			if ctx.Err() != nil || *budget <= 0 {
				entry.Complete = false
				return
			}
			children, err := directory.ReadDir(128)
			for _, child := range children {
				if ctx.Err() != nil || *budget <= 0 {
					entry.Complete = false
					return
				}
				childPath := filepath.Join(name, child.Name())
				childInfo, statErr := root.Lstat(childPath)
				if statErr != nil {
					entry.Complete = false
					*budget--
					continue
				}
				walk(childPath, childInfo)
			}
			if err == io.EOF {
				return
			}
			if err != nil {
				entry.Complete = false
				return
			}
		}
	}
	walk(relative, info)
}
