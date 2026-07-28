package threadstore

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
)

//go:embed reviewed_schema_manifest.json
var reviewedSchemaManifestJSON []byte

type reviewedSchemaManifest struct {
	SchemaKind string                   `json:"schema_kind"`
	Versions   []reviewedSchemaSnapshot `json:"versions"`
}

type reviewedSchemaSnapshot struct {
	Version int                    `json:"version"`
	Objects []reviewedSchemaObject `json:"sqlite_master"`
	Tables  []reviewedSchemaTable  `json:"tables"`
	Indexes []reviewedSchemaIndex  `json:"indexes"`
}

type reviewedSchemaObject struct {
	Type      string `json:"type"`
	Name      string `json:"name"`
	TableName string `json:"table_name"`
	SQL       string `json:"sql"`
}

type reviewedSchemaTable struct {
	Name    string                    `json:"name"`
	Columns []reviewedSchemaColumn    `json:"table_xinfo"`
	Indexes []reviewedTableIndexEntry `json:"index_list"`
}

type reviewedSchemaColumn struct {
	CID          int    `json:"cid"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	NotNull      int    `json:"not_null"`
	DefaultValue string `json:"default_value"`
	PrimaryKey   int    `json:"primary_key"`
	Hidden       int    `json:"hidden"`
}

type reviewedTableIndexEntry struct {
	Sequence int    `json:"sequence"`
	Name     string `json:"name"`
	Unique   int    `json:"unique"`
	Origin   string `json:"origin"`
	Partial  int    `json:"partial"`
}

type reviewedSchemaIndex struct {
	Name    string                      `json:"name"`
	Columns []reviewedSchemaIndexColumn `json:"index_xinfo"`
}

type reviewedSchemaIndexColumn struct {
	Sequence int    `json:"sequence"`
	CID      int    `json:"cid"`
	Name     string `json:"name"`
	Desc     int    `json:"desc"`
	Coll     string `json:"collation"`
	Key      int    `json:"key"`
}

var (
	reviewedSchemaManifestOnce sync.Once
	loadedReviewedManifest     reviewedSchemaManifest
	loadedReviewedManifestErr  error
)

func reviewedProductSchemaContract(version int) (reviewedSchemaSnapshot, error) {
	reviewedSchemaManifestOnce.Do(func() {
		if err := json.Unmarshal(reviewedSchemaManifestJSON, &loadedReviewedManifest); err != nil {
			loadedReviewedManifestErr = fmt.Errorf("decode reviewed threadstore schema manifest: %w", err)
			return
		}
		if loadedReviewedManifest.SchemaKind != threadstoreSchemaKind {
			loadedReviewedManifestErr = fmt.Errorf("reviewed threadstore schema kind %q, want %q", loadedReviewedManifest.SchemaKind, threadstoreSchemaKind)
		}
	})
	if loadedReviewedManifestErr != nil {
		return reviewedSchemaSnapshot{}, loadedReviewedManifestErr
	}
	for _, snapshot := range loadedReviewedManifest.Versions {
		if snapshot.Version == version {
			return snapshot, nil
		}
	}
	return reviewedSchemaSnapshot{}, fmt.Errorf("reviewed threadstore schema manifest is missing version %d", version)
}

func inspectReviewedSchemaTx(tx *sql.Tx) (reviewedSchemaSnapshot, error) {
	if tx == nil {
		return reviewedSchemaSnapshot{}, errors.New("nil tx")
	}
	var snapshot reviewedSchemaSnapshot
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&snapshot.Version); err != nil {
		return reviewedSchemaSnapshot{}, fmt.Errorf("read schema user_version: %w", err)
	}
	objectRows, err := tx.Query(`
SELECT type, name, tbl_name, COALESCE(sql, '')
FROM sqlite_master
ORDER BY type, name, tbl_name
`)
	if err != nil {
		return reviewedSchemaSnapshot{}, err
	}
	for objectRows.Next() {
		var object reviewedSchemaObject
		if err := objectRows.Scan(&object.Type, &object.Name, &object.TableName, &object.SQL); err != nil {
			_ = objectRows.Close()
			return reviewedSchemaSnapshot{}, err
		}
		object.SQL = normalizeReviewedSchemaSQL(object.SQL)
		snapshot.Objects = append(snapshot.Objects, object)
	}
	if err := objectRows.Err(); err != nil {
		_ = objectRows.Close()
		return reviewedSchemaSnapshot{}, err
	}
	if err := objectRows.Close(); err != nil {
		return reviewedSchemaSnapshot{}, err
	}

	for _, object := range snapshot.Objects {
		switch object.Type {
		case "table":
			table, err := inspectReviewedTableTx(tx, object.Name)
			if err != nil {
				return reviewedSchemaSnapshot{}, err
			}
			snapshot.Tables = append(snapshot.Tables, table)
		case "index":
			index, err := inspectReviewedIndexTx(tx, object.Name)
			if err != nil {
				return reviewedSchemaSnapshot{}, err
			}
			snapshot.Indexes = append(snapshot.Indexes, index)
		}
	}
	return snapshot, nil
}

func inspectReviewedTableTx(tx *sql.Tx, name string) (reviewedSchemaTable, error) {
	table := reviewedSchemaTable{Name: name}
	rows, err := tx.Query(fmt.Sprintf(`PRAGMA table_xinfo(%s)`, quoteReviewedIdentifier(name)))
	if err != nil {
		return reviewedSchemaTable{}, err
	}
	for rows.Next() {
		var column reviewedSchemaColumn
		var defaultValue sql.NullString
		if err := rows.Scan(&column.CID, &column.Name, &column.Type, &column.NotNull, &defaultValue, &column.PrimaryKey, &column.Hidden); err != nil {
			_ = rows.Close()
			return reviewedSchemaTable{}, err
		}
		column.DefaultValue = defaultValue.String
		table.Columns = append(table.Columns, column)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return reviewedSchemaTable{}, err
	}
	if err := rows.Close(); err != nil {
		return reviewedSchemaTable{}, err
	}

	rows, err = tx.Query(fmt.Sprintf(`PRAGMA index_list(%s)`, quoteReviewedIdentifier(name)))
	if err != nil {
		return reviewedSchemaTable{}, err
	}
	for rows.Next() {
		var index reviewedTableIndexEntry
		if err := rows.Scan(&index.Sequence, &index.Name, &index.Unique, &index.Origin, &index.Partial); err != nil {
			_ = rows.Close()
			return reviewedSchemaTable{}, err
		}
		table.Indexes = append(table.Indexes, index)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return reviewedSchemaTable{}, err
	}
	if err := rows.Close(); err != nil {
		return reviewedSchemaTable{}, err
	}
	sort.Slice(table.Indexes, func(i, j int) bool { return table.Indexes[i].Name < table.Indexes[j].Name })
	return table, nil
}

func inspectReviewedIndexTx(tx *sql.Tx, name string) (reviewedSchemaIndex, error) {
	index := reviewedSchemaIndex{Name: name}
	rows, err := tx.Query(fmt.Sprintf(`PRAGMA index_xinfo(%s)`, quoteReviewedIdentifier(name)))
	if err != nil {
		return reviewedSchemaIndex{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var column reviewedSchemaIndexColumn
		var columnName, collation sql.NullString
		if err := rows.Scan(&column.Sequence, &column.CID, &columnName, &column.Desc, &collation, &column.Key); err != nil {
			return reviewedSchemaIndex{}, err
		}
		column.Name = columnName.String
		column.Coll = collation.String
		index.Columns = append(index.Columns, column)
	}
	if err := rows.Err(); err != nil {
		return reviewedSchemaIndex{}, err
	}
	return index, nil
}

func normalizeReviewedSchemaSQL(value string) string {
	var out strings.Builder
	out.Grow(len(value))
	var quote byte
	pendingSpace := false
	for index := 0; index < len(value); index++ {
		current := value[index]
		if quote == 0 {
			if current == ' ' || current == '\t' || current == '\n' || current == '\r' {
				pendingSpace = out.Len() > 0
				continue
			}
			if pendingSpace {
				out.WriteByte(' ')
				pendingSpace = false
			}
			out.WriteByte(current)
			switch current {
			case '\'', '"':
				quote = current
			case '[':
				quote = ']'
			}
			continue
		}
		out.WriteByte(current)
		if current != quote {
			continue
		}
		if quote != ']' && index+1 < len(value) && value[index+1] == quote {
			out.WriteByte(value[index+1])
			index++
			continue
		}
		quote = 0
	}
	return strings.TrimSpace(out.String())
}

func compareReviewedSchemas(actual, expected reviewedSchemaSnapshot) error {
	if reflect.DeepEqual(actual, expected) {
		return nil
	}
	if actual.Version != expected.Version {
		return fmt.Errorf("user_version=%d, want %d", actual.Version, expected.Version)
	}
	if !reflect.DeepEqual(actual.Objects, expected.Objects) {
		for index := 0; index < len(actual.Objects) && index < len(expected.Objects); index++ {
			if actual.Objects[index] != expected.Objects[index] {
				return fmt.Errorf("sqlite_master differs at %d: actual=%#v expected=%#v", index, actual.Objects[index], expected.Objects[index])
			}
		}
		return fmt.Errorf("sqlite_master differs (actual objects=%d, expected=%d)", len(actual.Objects), len(expected.Objects))
	}
	if !reflect.DeepEqual(actual.Tables, expected.Tables) {
		return fmt.Errorf("table_xinfo or index_list differs (actual tables=%d, expected=%d)", len(actual.Tables), len(expected.Tables))
	}
	return fmt.Errorf("index_xinfo differs (actual indexes=%d, expected=%d)", len(actual.Indexes), len(expected.Indexes))
}

func quoteReviewedIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}
