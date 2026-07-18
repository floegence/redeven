package sqliteutil

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
)

func TableExistsTx(tx *sql.Tx, tableName string) (bool, error) {
	if tx == nil {
		return false, errors.New("nil tx")
	}
	tableName = strings.TrimSpace(tableName)
	if tableName == "" {
		return false, errors.New("missing table name")
	}
	var exists int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = ?
`, tableName).Scan(&exists); err != nil {
		return false, err
	}
	return exists > 0, nil
}

func TableColumnNamesTx(tx *sql.Tx, tableName string) ([]string, error) {
	if tx == nil {
		return nil, errors.New("nil tx")
	}
	tableName = strings.TrimSpace(tableName)
	if tableName == "" {
		return nil, errors.New("missing table name")
	}
	rows, err := tx.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, quoteIdentifier(tableName)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, err
		}
		columns = append(columns, name)
	}
	return columns, rows.Err()
}

func ListUserTablesTx(tx *sql.Tx) ([]string, error) {
	if tx == nil {
		return nil, errors.New("nil tx")
	}
	rows, err := tx.Query(`
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
  AND name <> ?
ORDER BY name ASC
`, metaTableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(tables)
	return tables, nil
}

func ListUserIndexesTx(tx *sql.Tx) ([]string, error) {
	if tx == nil {
		return nil, errors.New("nil tx")
	}
	rows, err := tx.Query(`
SELECT name
FROM sqlite_master
WHERE type = 'index'
  AND name NOT LIKE 'sqlite_%'
ORDER BY name ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var indexes []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		indexes = append(indexes, strings.TrimSpace(name))
	}
	return indexes, rows.Err()
}

func quoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(strings.TrimSpace(name), `"`, `""`) + `"`
}
