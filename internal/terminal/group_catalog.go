package terminal

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const DefaultTerminalGroupID = "default"

var (
	ErrTerminalGroupNotFound      = errors.New("terminal group not found")
	ErrTerminalGroupNameConflict  = errors.New("terminal group name already exists")
	ErrDefaultTerminalGroupLocked = errors.New("default terminal group is protected")
)

type Group struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	DefaultWorkingDir string `json:"default_working_dir"`
	SortOrder         int    `json:"sort_order"`
	CreatedAtMs       int64  `json:"created_at_ms"`
	UpdatedAtMs       int64  `json:"updated_at_ms"`
	IsDefault         bool   `json:"is_default"`
}

type GroupCatalogSnapshot struct {
	Revision uint64  `json:"revision"`
	Groups   []Group `json:"groups"`
}

type groupCatalog struct {
	mu       sync.Mutex
	db       *sql.DB
	revision uint64
	groups   map[string]Group
}

func newMemoryGroupCatalog(home string) *groupCatalog {
	now := time.Now().UnixMilli()
	group := Group{
		ID:                DefaultTerminalGroupID,
		Name:              "Default",
		DefaultWorkingDir: strings.TrimSpace(home),
		SortOrder:         0,
		CreatedAtMs:       now,
		UpdatedAtMs:       now,
		IsDefault:         true,
	}
	return &groupCatalog{revision: 1, groups: map[string]Group{group.ID: group}}
}

func openPersistentGroupCatalog(path string, home string) (*groupCatalog, error) {
	db, err := sqliteutil.Open(path, terminalGroupCatalogSchemaSpec(home))
	if err != nil {
		return nil, err
	}
	catalog := &groupCatalog{db: db, groups: make(map[string]Group)}
	if err := catalog.load(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return catalog, nil
}

func (c *groupCatalog) load() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var revision uint64
	if err := tx.QueryRow(`SELECT revision FROM terminal_group_catalog WHERE singleton_id = 1`).Scan(&revision); err != nil {
		return fmt.Errorf("read terminal group catalog revision: %w", err)
	}
	groups, err := readTerminalGroupsTx(tx)
	if err != nil {
		return err
	}
	defaultGroup, ok := groups[DefaultTerminalGroupID]
	if !ok || defaultGroup.Name != "Default" || defaultGroup.SortOrder != 0 {
		return errors.New("default terminal group invariant is invalid")
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	c.revision = revision
	c.groups = groups
	return nil
}

func readTerminalGroupsTx(tx *sql.Tx) (map[string]Group, error) {
	rows, err := tx.Query(`SELECT group_id, name, default_working_dir, sort_order, created_at_unix_ms, updated_at_unix_ms FROM terminal_groups ORDER BY sort_order, lower(name), group_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := make(map[string]Group)
	for rows.Next() {
		var group Group
		if err := rows.Scan(&group.ID, &group.Name, &group.DefaultWorkingDir, &group.SortOrder, &group.CreatedAtMs, &group.UpdatedAtMs); err != nil {
			return nil, err
		}
		group.IsDefault = group.ID == DefaultTerminalGroupID
		groups[group.ID] = group
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return groups, nil
}

func validateTerminalGroupName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("group name is required")
	}
	if utf8.RuneCountInString(name) > 64 {
		return "", errors.New("group name must be at most 64 characters")
	}
	return name, nil
}

func newTerminalGroupID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "group_" + hex.EncodeToString(raw), nil
}

func (c *groupCatalog) Snapshot() GroupCatalogSnapshot {
	if c == nil {
		return GroupCatalogSnapshot{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	groups := make([]Group, 0, len(c.groups))
	for _, group := range c.groups {
		groups = append(groups, group)
	}
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].SortOrder != groups[j].SortOrder {
			return groups[i].SortOrder < groups[j].SortOrder
		}
		return groups[i].ID < groups[j].ID
	})
	return GroupCatalogSnapshot{Revision: c.revision, Groups: groups}
}

func (c *groupCatalog) Group(groupID string) (Group, bool) {
	if c == nil {
		return Group{}, false
	}
	c.mu.Lock()
	group, ok := c.groups[strings.TrimSpace(groupID)]
	c.mu.Unlock()
	return group, ok
}

func (c *groupCatalog) Create(name string, defaultWorkingDir string) (GroupCatalogSnapshot, Group, error) {
	if c == nil {
		return GroupCatalogSnapshot{}, Group{}, errors.New("terminal group catalog is unavailable")
	}
	name, err := validateTerminalGroupName(name)
	if err != nil {
		return GroupCatalogSnapshot{}, Group{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, existing := range c.groups {
		if strings.EqualFold(existing.Name, name) {
			return GroupCatalogSnapshot{}, Group{}, ErrTerminalGroupNameConflict
		}
	}
	groupID, err := newTerminalGroupID()
	if err != nil {
		return GroupCatalogSnapshot{}, Group{}, err
	}
	now := time.Now().UnixMilli()
	maxOrder := 0
	for _, existing := range c.groups {
		if existing.SortOrder > maxOrder {
			maxOrder = existing.SortOrder
		}
	}
	group := Group{ID: groupID, Name: name, DefaultWorkingDir: defaultWorkingDir, SortOrder: maxOrder + 1, CreatedAtMs: now, UpdatedAtMs: now}
	if err := c.mutateLocked(func(tx *sql.Tx, revision uint64) error {
		_, execErr := tx.Exec(`INSERT INTO terminal_groups(group_id, name, default_working_dir, sort_order, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?)`, group.ID, group.Name, group.DefaultWorkingDir, group.SortOrder, group.CreatedAtMs, group.UpdatedAtMs)
		return execErr
	}); err != nil {
		return GroupCatalogSnapshot{}, Group{}, err
	}
	c.groups[group.ID] = group
	return c.snapshotLocked(), group, nil
}

func (c *groupCatalog) Update(groupID string, name *string, defaultWorkingDir *string) (GroupCatalogSnapshot, Group, error) {
	if c == nil {
		return GroupCatalogSnapshot{}, Group{}, errors.New("terminal group catalog is unavailable")
	}
	groupID = strings.TrimSpace(groupID)
	c.mu.Lock()
	defer c.mu.Unlock()
	group, ok := c.groups[groupID]
	if !ok {
		return GroupCatalogSnapshot{}, Group{}, ErrTerminalGroupNotFound
	}
	if name != nil {
		validated, err := validateTerminalGroupName(*name)
		if err != nil {
			return GroupCatalogSnapshot{}, Group{}, err
		}
		if group.IsDefault && validated != "Default" {
			return GroupCatalogSnapshot{}, Group{}, ErrDefaultTerminalGroupLocked
		}
		for _, existing := range c.groups {
			if existing.ID != group.ID && strings.EqualFold(existing.Name, validated) {
				return GroupCatalogSnapshot{}, Group{}, ErrTerminalGroupNameConflict
			}
		}
		group.Name = validated
	}
	if defaultWorkingDir != nil {
		group.DefaultWorkingDir = strings.TrimSpace(*defaultWorkingDir)
	}
	group.UpdatedAtMs = time.Now().UnixMilli()
	if err := c.mutateLocked(func(tx *sql.Tx, revision uint64) error {
		_, execErr := tx.Exec(`UPDATE terminal_groups SET name = ?, default_working_dir = ?, updated_at_unix_ms = ? WHERE group_id = ?`, group.Name, group.DefaultWorkingDir, group.UpdatedAtMs, group.ID)
		return execErr
	}); err != nil {
		return GroupCatalogSnapshot{}, Group{}, err
	}
	c.groups[group.ID] = group
	return c.snapshotLocked(), group, nil
}

func (c *groupCatalog) Reorder(groupID string, beforeGroupID string) (GroupCatalogSnapshot, error) {
	if c == nil {
		return GroupCatalogSnapshot{}, errors.New("terminal group catalog is unavailable")
	}
	groupID = strings.TrimSpace(groupID)
	beforeGroupID = strings.TrimSpace(beforeGroupID)
	if groupID == "" {
		return GroupCatalogSnapshot{}, errors.New("group_id is required")
	}
	if groupID == DefaultTerminalGroupID || beforeGroupID == DefaultTerminalGroupID {
		return GroupCatalogSnapshot{}, ErrDefaultTerminalGroupLocked
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.groups[groupID]; !ok {
		return GroupCatalogSnapshot{}, ErrTerminalGroupNotFound
	}
	if beforeGroupID != "" {
		if _, ok := c.groups[beforeGroupID]; !ok {
			return GroupCatalogSnapshot{}, ErrTerminalGroupNotFound
		}
	}
	if beforeGroupID == groupID {
		return c.snapshotLocked(), nil
	}

	orderedGroups := c.snapshotLocked().Groups
	orderedMovableIDs := make([]string, 0, len(orderedGroups)-1)
	for _, group := range orderedGroups {
		if !group.IsDefault {
			orderedMovableIDs = append(orderedMovableIDs, group.ID)
		}
	}
	nextOrder := make([]string, 0, len(orderedMovableIDs))
	for _, candidate := range orderedMovableIDs {
		if candidate != groupID {
			nextOrder = append(nextOrder, candidate)
		}
	}
	insertIndex := len(nextOrder)
	if beforeGroupID != "" {
		for index, candidate := range nextOrder {
			if candidate == beforeGroupID {
				insertIndex = index
				break
			}
		}
	}
	nextOrder = append(nextOrder, "")
	copy(nextOrder[insertIndex+1:], nextOrder[insertIndex:])
	nextOrder[insertIndex] = groupID
	unchanged := len(nextOrder) == len(orderedMovableIDs)
	if unchanged {
		for index, candidate := range nextOrder {
			if candidate != orderedMovableIDs[index] {
				unchanged = false
				break
			}
		}
	}
	if unchanged {
		return c.snapshotLocked(), nil
	}

	now := time.Now().UnixMilli()
	nextGroups := make(map[string]Group, len(c.groups))
	for id, group := range c.groups {
		nextGroups[id] = group
	}
	for index, id := range nextOrder {
		group := nextGroups[id]
		group.SortOrder = index + 1
		if id == groupID {
			group.UpdatedAtMs = now
		}
		nextGroups[id] = group
	}
	if err := c.mutateLocked(func(tx *sql.Tx, revision uint64) error {
		maxSortOrder := 0
		for _, group := range c.groups {
			if group.SortOrder > maxSortOrder {
				maxSortOrder = group.SortOrder
			}
		}
		for index, id := range nextOrder {
			if _, execErr := tx.Exec(`UPDATE terminal_groups SET sort_order = ? WHERE group_id = ?`, maxSortOrder+index+1, id); execErr != nil {
				return execErr
			}
		}
		for _, id := range nextOrder {
			group := nextGroups[id]
			if _, execErr := tx.Exec(`UPDATE terminal_groups SET sort_order = ?, updated_at_unix_ms = ? WHERE group_id = ?`, group.SortOrder, group.UpdatedAtMs, group.ID); execErr != nil {
				return execErr
			}
		}
		return nil
	}); err != nil {
		return GroupCatalogSnapshot{}, err
	}
	c.groups = nextGroups
	return c.snapshotLocked(), nil
}

func (c *groupCatalog) Delete(groupID string) (GroupCatalogSnapshot, error) {
	if c == nil {
		return GroupCatalogSnapshot{}, errors.New("terminal group catalog is unavailable")
	}
	groupID = strings.TrimSpace(groupID)
	if groupID == DefaultTerminalGroupID {
		return GroupCatalogSnapshot{}, ErrDefaultTerminalGroupLocked
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.groups[groupID]; !ok {
		return GroupCatalogSnapshot{}, ErrTerminalGroupNotFound
	}
	if err := c.mutateLocked(func(tx *sql.Tx, revision uint64) error {
		_, execErr := tx.Exec(`DELETE FROM terminal_groups WHERE group_id = ?`, groupID)
		return execErr
	}); err != nil {
		return GroupCatalogSnapshot{}, err
	}
	delete(c.groups, groupID)
	return c.snapshotLocked(), nil
}

func (c *groupCatalog) AdvanceRevision() (uint64, error) {
	if c == nil {
		return 0, errors.New("terminal group catalog is unavailable")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.mutateLocked(nil); err != nil {
		return 0, err
	}
	return c.revision, nil
}

func (c *groupCatalog) mutateLocked(mutate func(*sql.Tx, uint64) error) error {
	nextRevision := c.revision + 1
	if c.db == nil {
		c.revision = nextRevision
		return nil
	}
	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if mutate != nil {
		if err := mutate(tx, nextRevision); err != nil {
			return err
		}
	}
	result, err := tx.Exec(`UPDATE terminal_group_catalog SET revision = ? WHERE singleton_id = 1 AND revision = ?`, nextRevision, c.revision)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("terminal group catalog revision changed concurrently")
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	c.revision = nextRevision
	return nil
}

func (c *groupCatalog) snapshotLocked() GroupCatalogSnapshot {
	groups := make([]Group, 0, len(c.groups))
	for _, group := range c.groups {
		groups = append(groups, group)
	}
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].SortOrder != groups[j].SortOrder {
			return groups[i].SortOrder < groups[j].SortOrder
		}
		return groups[i].ID < groups[j].ID
	})
	return GroupCatalogSnapshot{Revision: c.revision, Groups: groups}
}

func (c *groupCatalog) Close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	db := c.db
	c.db = nil
	c.mu.Unlock()
	if db != nil {
		return db.Close()
	}
	return nil
}
